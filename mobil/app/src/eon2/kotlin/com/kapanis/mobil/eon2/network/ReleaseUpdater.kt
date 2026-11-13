package com.kapanis.mobil.eon2.network

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class MobileUpdateState(val phase: String = "current", val version: String? = null,
    val progress: Float = 0f, val message: String = "Eon güncel")

data class AndroidUpdateRelease(val version: String, val versionCode: Long, val sha256: String, val size: Long, val url: String)

object UpdateManifest {
    fun parse(json: JSONObject, tag: String, packageId: String): AndroidUpdateRelease {
        require(json.getInt("schemaVersion") == 1)
        val android = json.getJSONObject("android")
        return validate(tag, json.getString("version"), android.getString("version"), android.getString("packageId"),
            packageId, android.getLong("versionCode"), android.getString("sha256"), android.getLong("size"))
    }
    fun validate(tag: String, version: String, androidVersion: String, packageId: String, expectedPackage: String,
        code: Long, hash: String, size: Long): AndroidUpdateRelease {
        require(Regex("v\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?").matches(tag)) { "Geçersiz yayın etiketi." }
        require(version == tag.drop(1) && androidVersion == tag.drop(1) && packageId == expectedPackage &&
            packageId == "com.kapanis.mobil.eon2.dev") { "Bu paket için uygun güncelleme yok." }
        require(code in 1..Int.MAX_VALUE.toLong() && size in 1..(300L * 1024 * 1024) && Regex("[a-f0-9]{64}").matches(hash)) { "Güncelleme bilgisi geçersiz." }
        return AndroidUpdateRelease(tag.drop(1), code, hash, size,
            "https://github.com/geniusprr/Eon/releases/download/$tag/Eon-Android-preview.apk")
    }
}

/** Process-owned download survives tab changes and rotation; Android owns installation approval. */
class ReleaseUpdater private constructor(context: Context) {
    private val context = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS).callTimeout(3, TimeUnit.MINUTES).build()
    private val mutable = MutableStateFlow(MobileUpdateState(phase = "checking", message = "Güncelleme bilgisi bekleniyor"))
    val state = mutable.asStateFlow()
    private val directory = File(this.context.cacheDir, "updates")
    @Volatile private var release: AndroidUpdateRelease? = null
    @Volatile private var busy = false
    private var lastCheck = 0L
    private val installed = this.context.packageManager.getPackageInfo(this.context.packageName, 0)
    val currentVersion: String = installed.versionName ?: ""
    private val currentCode = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else @Suppress("DEPRECATION") installed.versionCode.toLong()

    init { scope.launch { while (true) { kotlinx.coroutines.delay(4 * 60 * 60 * 1000L); check() } } }

    @Synchronized fun check(manual: Boolean = false) {
        if (busy || (!manual && System.currentTimeMillis() - lastCheck < 4 * 60 * 60 * 1000L)) return
        if (state.value.phase == "downloaded") return
        busy = true
        lastCheck = System.currentTimeMillis()
        scope.launch {
            mutable.value = MobileUpdateState(phase = "checking", message = "GitHub Releases denetleniyor…")
            try {
                val releases = JSONArray(getText("https://api.github.com/repos/geniusprr/Eon/releases?per_page=20", 256 * 1024))
                var candidate: JSONObject? = null
                for (index in 0 until releases.length()) {
                    val item = releases.getJSONObject(index)
                    if (item.optBoolean("draft") || (!currentVersion.contains('-') && item.optBoolean("prerelease"))) continue
                    val assets = item.optJSONArray("assets") ?: continue
                    if ((0 until assets.length()).any { assets.getJSONObject(it).optString("name") == "eon-update.json" }) { candidate = item; break }
                }
                if (candidate == null) { mutable.value = MobileUpdateState(); return@launch }
                val tag = candidate.getString("tag_name")
                require(Regex("v\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?").matches(tag))
                val next = UpdateManifest.parse(JSONObject(getText("https://github.com/geniusprr/Eon/releases/download/$tag/eon-update.json", 16 * 1024)), tag, context.packageName)
                if (next.versionCode <= currentCode) { mutable.value = MobileUpdateState(); return@launch }
                release = next
                download(next)
                mutable.value = MobileUpdateState("downloaded", next.version, 1f, "Yeni sürüm kuruluma hazır")
            } catch (_: Exception) {
                mutable.value = MobileUpdateState("error", release?.version, message = "Güncelleme alınamadı. Bağlantını kontrol edip yeniden dene.")
            } finally { busy = false }
        }
    }
    private fun getText(url: String, maximum: Int): String {
        client.newCall(Request.Builder().url(url).header("Accept", "application/vnd.github+json").header("User-Agent", "Eon-Android-Updater").build()).execute().use { response ->
            check(response.isSuccessful) { "GitHub yanıtı alınamadı." }
            val stream = response.body?.byteStream() ?: error("Boş yanıt.")
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = stream.read(buffer); if (count < 0) break
                check(output.size() + count <= maximum) { "Güncelleme yanıtı çok büyük." }
                output.write(buffer, 0, count)
            }
            return output.toString("UTF-8")
        }
    }
    private fun file(next: AndroidUpdateRelease) = File(directory, "${next.sha256}.apk")
    private fun verified(next: AndroidUpdateRelease): Boolean {
        val apk = file(next)
        if (!apk.isFile || apk.length() != next.size) return false
        val hash = MessageDigest.getInstance("SHA-256")
        apk.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) } }
        return hash.digest().joinToString("") { "%02x".format(it) } == next.sha256
    }
    private fun download(next: AndroidUpdateRelease) {
        if (verified(next)) return
        check(directory.mkdirs() || directory.isDirectory)
        val temporary = File(directory, "${next.sha256}.part")
        mutable.value = MobileUpdateState("downloading", next.version, message = "Arka planda indiriliyor")
        try {
            client.newCall(Request.Builder().url(next.url).build()).execute().use { response ->
                check(response.isSuccessful)
                val input = response.body?.byteStream() ?: error("APK alınamadı.")
                var received = 0L; var lastProgress = 0L
                val hash = MessageDigest.getInstance("SHA-256")
                temporary.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer); if (count < 0) break
                        received += count
                        check(received <= next.size) { "APK çok büyük." }
                        output.write(buffer, 0, count); hash.update(buffer, 0, count)
                        if (System.currentTimeMillis() - lastProgress > 250) {
                            lastProgress = System.currentTimeMillis()
                            mutable.value = MobileUpdateState("downloading", next.version, received.toFloat() / next.size, "Arka planda indiriliyor")
                        }
                    }
                    check(received == next.size && hash.digest().joinToString("") { "%02x".format(it) } == next.sha256) { "APK doğrulanamadı." }
                }
            }
            check(temporary.renameTo(file(next))) { "İndirilen dosya saklanamadı." }
        } catch (error: Exception) { temporary.delete(); throw error }
    }
    fun install() {
        val next = release ?: return
        if (state.value.phase != "downloaded") return
        if (!context.packageManager.canRequestPackageInstalls()) {
            try { context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            catch (_: Exception) { mutable.value = state.value.copy(message = "Android ayarlarından Eon için uygulama yükleme izni ver.") }
            return
        }
        scope.launch {
            try {
                check(verified(next)) { "APK doğrulanamadı. Yeniden indir." }
                val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
                val archive = context.packageManager.getPackageArchiveInfo(file(next).path, flags) ?: error("APK okunamadı.")
                val own = context.packageManager.getPackageInfo(context.packageName, flags)
                val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else @Suppress("DEPRECATION") archive.versionCode.toLong()
                check(archive.packageName == context.packageName && code == next.versionCode && code > currentCode) { "APK sürümü uyumsuz." }
                @Suppress("DEPRECATION")
                val ownSignatures = if (Build.VERSION.SDK_INT >= 28) own.signingInfo?.apkContentsSigners else own.signatures
                @Suppress("DEPRECATION")
                val newSignatures = if (Build.VERSION.SDK_INT >= 28) archive.signingInfo?.apkContentsSigners else archive.signatures
                check(!ownSignatures.isNullOrEmpty() && !newSignatures.isNullOrEmpty() && ownSignatures.toSet() == newSignatures.toSet()) { "APK imzası kurulu uygulamayla eşleşmiyor." }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.downloads", file(next))
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (error: Exception) { mutable.value = state.value.copy(phase = "error", message = error.message ?: "Kurulum başlatılamadı.") }
        }
    }
    companion object {
        @Volatile private var instance: ReleaseUpdater? = null
        fun get(context: Context): ReleaseUpdater = instance ?: synchronized(this) { instance ?: ReleaseUpdater(context).also { instance = it } }
    }
}
