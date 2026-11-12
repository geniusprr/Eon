package com.kapanis.mobil.eon2.network

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/** Exposes saved public downloads on API 26–28 via temporary per-file grants. */
class LegacyDownloadsProvider : FileProvider()

internal data class ReceivedDownload(
    val id: String,
    val name: String,
    val size: Long,
    val uri: Uri,
    val mimeType: String,
    val savedAt: Long,
)

/** One foreground receiver shared by every Eon screen. Called sequentially on Dispatchers.IO. */
internal class IncomingDownloads(private val context: Context, private val client: EonUsbClient) {
    private val receipts = context.getSharedPreferences("eon2-downloads", Context.MODE_PRIVATE)
    private val saved = MutableStateFlow<List<ReceivedDownload>>(emptyList())
    val receivedFiles = saved.asStateFlow()

    fun loadReceipts() {
        saved.value = receipts.all.mapNotNull { (key, value) ->
            if (!key.startsWith("file-") || value !is String) return@mapNotNull null
            try {
                val record = JSONObject(value)
                ReceivedDownload(key.removePrefix("file-"), record.getString("name"), record.getLong("size"),
                    Uri.parse(record.getString("uri")), record.getString("mimeType"), record.getLong("savedAt"))
            } catch (_: org.json.JSONException) { null }
        }.sortedByDescending { it.savedAt }
    }

    suspend fun receivePending() {
        // A paired device may have file access disabled; passive polling is then idle.
        val files = try { client.files().getJSONArray("files") }
        catch (_: EonAccessDeniedException) { return }
        for (index in 0 until files.length()) {
            currentCoroutineContext().ensureActive()
            val file = files.getJSONObject(index)
            if (file.getString("direction") != "send" || file.getString("state") !in listOf("queued", "transferring")) continue
            check(Build.VERSION.SDK_INT >= 29 || context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
                "Downloads’a kaydetmek için Android depolama iznini aç."
            }
            val id = file.getString("id")
            require(Regex("^[a-zA-Z0-9_-]{1,90}$").matches(id)) { "Geçersiz aktarım kimliği." }
            val name = file.getString("fileName")
            require(name.isNotBlank() && name.length <= 255 && name != "." && name != ".." && name.none { it == '/' || it == '\\' || it.code < 32 }) { "Geçersiz dosya adı." }
            // Persist a receipt before ACK so an interrupted ACK cannot download the file twice.
            if (!receipts.getBoolean("done-$id", false)) {
                val coroutine = currentCoroutineContext()
                val progress: (Long) -> Unit = { coroutine.ensureActive() }
                val extension = File(name).extension.lowercase(Locale.ROOT)
                val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
                val download = ReceivedDownload(id, name, file.getLong("size"), Uri.EMPTY, mimeType, System.currentTimeMillis())
                if (Build.VERSION.SDK_INT >= 29) saveMediaStore(download, file, progress)
                else saveLegacy(download, file, progress)
            }
            client.finishReceivedFile(id)
        }
    }

    private fun recordSaved(download: ReceivedDownload, uri: Uri) {
        val completed = download.copy(uri = uri, savedAt = System.currentTimeMillis())
        val record = JSONObject().put("name", completed.name).put("size", completed.size)
            .put("uri", uri.toString()).put("mimeType", completed.mimeType).put("savedAt", completed.savedAt)
        val id = completed.id
        check(receipts.edit().putBoolean("done-$id", true).putString("file-$id", record.toString())
            .remove("pending-$id").commit()) { "İndirme kaydı saklanamadı." }
        saved.value = listOf(completed) + saved.value
    }

    @android.annotation.TargetApi(29)
    private fun saveMediaStore(download: ReceivedDownload, file: JSONObject, progress: (Long) -> Unit) {
        val id = download.id
        val resolver = context.contentResolver
        // Remove a partial download left by process death before starting again.
        receipts.getString("pending-$id", null)?.let { resolver.delete(Uri.parse(it), null, null) }
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, download.name)
            put(MediaStore.Downloads.MIME_TYPE, download.mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Downloads dosyası oluşturulamadı.")
        try {
            check(receipts.edit().putString("pending-$id", uri.toString()).commit()) { "İndirme kaydı saklanamadı." }
            resolver.openFileDescriptor(uri, "w")?.use { descriptor ->
                FileOutputStream(descriptor.fileDescriptor).use { output ->
                    client.receiveFile(file, output, progress)
                    output.fd.sync()
                }
            } ?: error("Downloads dosyası açılamadı.")
            check(resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null) == 1) { "İndirme tamamlanamadı." }
            recordSaved(download, uri)
        } catch (error: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            receipts.edit().remove("done-$id").remove("file-$id").apply()
            throw error
        }
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(download: ReceivedDownload, file: JSONObject, progress: (Long) -> Unit) {
        val id = download.id
        val name = download.name
        val directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        check(directory.isDirectory || directory.mkdirs()) { "Downloads klasörü açılamadı." }
        val temporary = File(directory, ".eon-$id.part")
        try {
            FileOutputStream(temporary).use { output ->
                client.receiveFile(file, output, progress)
                output.fd.sync()
            }
            var destination = File(directory, name)
            var suffix = 1
            while (!destination.createNewFile()) {
                destination = File(directory, "${File(name).nameWithoutExtension} (${suffix++})${File(name).extension.let { if (it.isEmpty()) "" else ".$it" }}")
            }
            try {
                check(temporary.renameTo(destination)) { "İndirilen dosya kaydedilemedi." }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.downloads", destination)
                recordSaved(download, uri)
            } catch (error: Exception) {
                destination.delete()
                receipts.edit().remove("done-$id").remove("file-$id").apply()
                throw error
            }
            MediaScannerConnection.scanFile(context, arrayOf(destination.absolutePath), null, null)
        } finally { temporary.delete() }
    }
}
