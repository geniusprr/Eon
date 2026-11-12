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
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject

/** One foreground receiver shared by every Eon screen. Called sequentially on Dispatchers.IO. */
class IncomingDownloads(private val context: Context, private val client: EonUsbClient) {
    private val receipts = context.getSharedPreferences("eon2-downloads", Context.MODE_PRIVATE)

    suspend fun receivePending(): List<String> {
        // A paired device may have file access disabled; passive polling is then idle.
        val files = try { client.files().getJSONArray("files") }
        catch (_: EonAccessDeniedException) { return emptyList() }
        val received = mutableListOf<String>()
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
                if (Build.VERSION.SDK_INT >= 29) saveMediaStore(id, name, file, progress)
                else saveLegacy(id, name, file, progress)
            }
            client.finishReceivedFile(id)
            received.add(name)
        }
        return received
    }

    @android.annotation.TargetApi(29)
    private fun saveMediaStore(id: String, name: String, file: JSONObject, progress: (Long) -> Unit) {
        val resolver = context.contentResolver
        // Remove a partial download left by process death before starting again.
        receipts.getString("pending-$id", null)?.let { resolver.delete(Uri.parse(it), null, null) }
        val extension = name.substringAfterLast('.', "").lowercase(java.util.Locale.ROOT)
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream")
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
            check(receipts.edit().putBoolean("done-$id", true).remove("pending-$id").commit()) { "İndirme kaydı saklanamadı." }
        } catch (error: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            receipts.edit().remove("done-$id").apply()
            throw error
        }
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(id: String, name: String, file: JSONObject, progress: (Long) -> Unit) {
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
                check(receipts.edit().putBoolean("done-$id", true).commit()) { "İndirme kaydı saklanamadı." }
            } catch (error: Exception) {
                destination.delete()
                receipts.edit().remove("done-$id").apply()
                throw error
            }
            MediaScannerConnection.scanFile(context, arrayOf(destination.absolutePath), null, null)
        } finally { temporary.delete() }
    }
}
