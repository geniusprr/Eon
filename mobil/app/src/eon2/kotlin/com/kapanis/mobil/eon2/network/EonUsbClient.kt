package com.kapanis.mobil.eon2.network

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.kapanis.mobil.eon2.data.EonNotesRepository
import com.kapanis.mobil.eon2.data.SyncApplyResult
import com.kapanis.mobil.eon2.protocol.CanonicalNotes
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.security.KeyStore
import java.security.SecureRandom
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class EonPeerStatus(val connected: Boolean, val name: String, val paired: Boolean, val system: JSONObject? = null, val transport: String? = null)
data class UsbPrompt(val id: String, val hostName: String)
data class DesktopSettings(val theme: String?, val tailscale: Boolean, val autostart: Boolean)

data class EonAiState(val configured: Boolean, val model: String, val models: List<String>)
data class EonAiReply(val reply: String, val actions: List<String>)
data class EonPendingCommand(val id: String, val name: String, val command: String, val expiresAt: Long)

data class EonSyncReport(val sent: Int, val received: Int, val duplicated: Int, val conflicted: Int)

/** A concurrent PC-side edit invalidated the revision used by the phone. */
class EonDeckConflictException(val serverLayout: JSONObject?) : IllegalStateException("Panel başka cihazda değiştirildi.")
class EonAccessDeniedException : IllegalStateException("PC erişimi reddedildi. Cihazlar bölümünden bu işlem için izin ver; eşleştirme kaldırıldıysa yeniden eşleştir.")

/** Uses Android local loopback through ADB reverse; never scans or connects to arbitrary LAN IPs. */
class EonUsbClient(private val context: Context, private val repository: EonNotesRepository) {
    companion object {
        // One bounded connection pool/dispatcher for every screen and configuration change.
        private val http = OkHttpClient.Builder().connectTimeout(1200, TimeUnit.MILLISECONDS)
            .followRedirects(false).followSslRedirects(false)
            .readTimeout(7, TimeUnit.SECONDS).writeTimeout(7, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
        // Model inference can take longer than routine device polling. Reuse the same pool.
        private val aiHttp = http.newBuilder().readTimeout(90, TimeUnit.SECONDS)
            .callTimeout(95, TimeUnit.SECONDS).build()
    }
    private val prefs = context.getSharedPreferences("eon2-pairing", Context.MODE_PRIVATE)
    private val usbBaseUrl = "http://127.0.0.1:8768"
    @Volatile private var currentBaseUrl: String = usbBaseUrl
    private val keystore = LocalSecretStore(context)
    val isPaired: Boolean get() = keystore.getSecret() != null
    val tailscaleAllowed: Boolean get() = prefs.getBoolean("tailscaleAllowed", false)

    fun setTailscaleAllowed(allowed: Boolean) {
        check(prefs.edit().putBoolean("tailscaleAllowed", allowed).commit())
        if (!allowed) currentBaseUrl = usbBaseUrl
    }

    private fun tailnetHostname(): String? {
        val hostname = prefs.getString("tailnetHost", null) ?: return null
        return hostname.takeIf { it.length <= 253 && it.matches(Regex("[A-Za-z0-9.-]+\\.ts\\.net")) && !it.contains("..") }
    }

    private fun rememberTailnetHostname(hostname: String?) {
        if (hostname.isNullOrEmpty()) return
        val validated = hostname.takeIf { it.length <= 253 && it.matches(Regex("[A-Za-z0-9.-]+\\.ts\\.net")) && !it.contains("..") }
        if (validated != null) check(prefs.edit().putString("tailnetHost", validated).commit())
    }

    fun detect(): EonPeerStatus {
        return try {
            val (endpoint, hello) = try {
                usbBaseUrl to request("GET", "/v1/hello", null, false, usbBaseUrl)
            } catch (usbError: Exception) {
                val host = if (tailscaleAllowed) tailnetHostname() else null
                if (host == null) throw usbError
                val secureEndpoint = "https://$host:8769"
                secureEndpoint to request("GET", "/v1/hello", null, false, secureEndpoint)
            }
            check(hello.getInt("protocol") == 1 && (hello.getString("transport") == "usb" || hello.getString("transport") == "tailscale")) { "Eon protokolü uyuşmuyor" }
            currentBaseUrl = endpoint
            val name = hello.optString("device", "Eon Desktop")
            if (isPaired) {
                try {
                    val status = request("GET", "/v1/system", null, true, endpoint)
                    if (endpoint == usbBaseUrl) rememberTailnetHostname(hello.optString("tailnetHost"))
                    EonPeerStatus(true, name, true, status, hello.getString("transport"))
                } catch (_: Exception) { EonPeerStatus(true, name, false, transport=hello.getString("transport")) }
            } else EonPeerStatus(true, name, false, transport=hello.getString("transport"))
        } catch (_: Exception) { EonPeerStatus(false, "Bilgisayar bekleniyor", isPaired) }
    }

    fun newPairingToken(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }
        .joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }

    fun pairingPrompt(): UsbPrompt? {
        val response = request("GET", "/v1/usb-approval/prompt", null, false, usbBaseUrl)
        val prompt = response.optJSONObject("prompt") ?: return null
        return UsbPrompt(prompt.getString("id"), response.optString("hostName", "Eon Desktop"))
    }

    fun requestPairing(token: String): String = pairingStep("request", token)

    fun pairingStatus(token: String): String = pairingStep("status", token)

    fun answerPairing(prompt: UsbPrompt, accepted: Boolean, token: String): String =
        pairingStep("decision", token, JSONObject().put("requestId", prompt.id).put("accepted", accepted))

    private fun pairingStep(step: String, token: String, payload: JSONObject = JSONObject()): String {
        val name = listOf(Build.MANUFACTURER, Build.MODEL).joinToString(" ").trim().take(80).ifBlank { "Android cihaz" }
        payload.put("id", repository.deviceId).put("name", name).put("token", token)
        val response = request("POST", "/v1/usb-approval/$step", payload, false, usbBaseUrl)
        val state = response.getString("state")
        if (state == "approved") {
            val secret = response.getString("secret")
            require(secret.length == 43) { "Eşleştirme anahtarı geçersiz." }
            repository.adoptVault(response.getString("vaultId"))
            keystore.saveSecret(secret)
            rememberTailnetHostname(response.optString("tailnetHost"))
        }
        return state
    }

    fun desktopSettings(): DesktopSettings = readSettings(request("GET", "/v1/settings", null, true))

    fun updateDesktopSettings(key: String, value: Any): DesktopSettings =
        readSettings(request("POST", "/v1/settings", JSONObject().put("key", key).put("value", value), true))

    private fun readSettings(payload: JSONObject): DesktopSettings {
        val allowed = payload.getBoolean("tailscale")
        if (tailscaleAllowed != allowed) setTailscaleAllowed(allowed)
        return DesktopSettings(payload.optString("theme").takeIf { it in setOf("obsidian", "ocean", "violet", "rose", "light") },
            allowed, payload.getBoolean("autostart"))
    }

    fun forgetLocalCredentials() {
        keystore.removeSecret()
    }

    fun controls(): JSONObject = request("GET", "/v1/actions/list", null, true)
    fun aiState(): EonAiState {
        val response = request("GET", "/v1/ai/state", null, true)
        return EonAiState(response.optBoolean("configured"), response.optString("model"),
            response.optJSONArray("models")?.stringItems().orEmpty())
    }

    fun aiModels(): List<String> = request("GET", "/v1/ai/models", null, true)
        .optJSONArray("models")?.stringItems().orEmpty()

    fun aiSend(content: String, model: String? = null, history: List<Pair<String, String>> = emptyList()): EonAiReply {
        require(content.isNotBlank() && content.length <= 4000) { "Mesaj 1-4000 karakter olmalı." }
        require(history.size <= 10 && history.all { (role, message) ->
            role in setOf("user", "assistant") && message.isNotBlank() && message.length <= 900
        }) { "AI konuşma geçmişi geçersiz." }
        val payload = JSONObject().put("content", content.trim())
        if (!model.isNullOrBlank()) payload.put("model", model)
        if (history.isNotEmpty()) payload.put("history", JSONArray().apply {
            history.forEach { (role, message) ->
                put(JSONObject().put("role", role).put("content", message))
            }
        })
        val response = request("POST", "/v1/ai/send", payload, true)
        return EonAiReply(response.getString("reply"), response.optJSONArray("actions")?.stringItems().orEmpty())
    }

    fun aiPendingCommand(): EonPendingCommand? {
        val response = request("GET", "/v1/ai/pending", null, true)
        if (response.length() == 0) return null
        val id = response.getString("id")
        require(id.isNotBlank()) { "Bekleyen kısayol kimliği eksik." }
        return EonPendingCommand(id, response.getString("name"), response.getString("command"),
            response.getLong("expiresAt"))
    }

    /** Explicit user approval only. Saving the shortcut must never execute its command. */
    fun aiApproveCommand(id: String): JSONObject {
        require(id.isNotBlank()) { "Onaylanacak kısayol bulunamadı." }
        return request("POST", "/v1/ai/approve", JSONObject().put("id", id), true)
    }

    fun aiRejectCommand(id: String) {
        require(id.isNotBlank()) { "Reddedilecek kısayol bulunamadı." }
        val result = request("POST", "/v1/ai/reject", JSONObject().put("id", id), true)
        check(result.getBoolean("ok")) { "Kısayol önerisi reddedilemedi." }
    }

    fun deck(): JSONObject = request("GET", "/v1/deck", null, true)
    fun deckLayout(): JSONObject = request("GET", "/v1/deck/layout", null, true)
    fun saveDeckLayout(baseRevision: Int, widgets: JSONArray, quickIds: List<String>? = null,
        updateQuickIds: Boolean = false, pages: JSONArray? = null, hideShortcutNames: Boolean? = null): JSONObject = request("POST", "/v1/deck/layout",
        JSONObject().put("baseRevision", baseRevision).put("widgets", widgets).apply {
            if (updateQuickIds) put("quickIds", quickIds?.let { JSONArray(it) } ?: JSONObject.NULL)
            if (pages != null) put("pages", pages)
            if (hideShortcutNames != null) put("hideShortcutNames", hideShortcutNames)
        }, true)
    fun executeDeckCommand(id: String): JSONObject = request("POST", "/v1/deck/execute", JSONObject().put("id", id), true)
    fun saveAction(action: JSONObject): JSONObject = request("POST", "/v1/actions/save", action, true)
    fun executeAction(action: JSONObject): JSONObject {
        return executeAction(action.getString("id"), action.getString("kind"))
    }
    fun executeAction(id: String, kind: String): JSONObject = request("POST",
        if (kind in listOf("lock", "shutdown", "restart", "cancel")) "/v1/power/execute" else "/v1/actions/execute",
        JSONObject().put("id", id), true)
    fun files(): JSONObject = request("GET", "/v1/files/list", null, true)

    fun sendFile(name: String, size: Long, input: java.io.InputStream, progress: (Long) -> Unit) {
        require(size in 0..8L * 1024 * 1024 * 1024) { "Dosya boyutu bilinmeli ve 8 GB sınırını aşmamalı." }
        val session = request("POST", "/v1/files/prepare", JSONObject().put("fileName", name).put("size", size), true)
        val id = session.getString("id")
        try {
            val buffer = ByteArray(256 * 1024)
            var offset = 0L
            while (offset < size) {
                val count = input.read(buffer, 0, minOf(buffer.size.toLong(), size - offset).toInt())
                check(count > 0) { "Kaynak dosya eksik veya değişmiş." }
                val data = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
                val result = request("POST", "/v1/files/chunk", JSONObject().put("id", id).put("offset", offset).put("data", data), true)
                offset += count
                check(result.getLong("offset") == offset) { "Aktarım konumu uyuşmuyor." }
                progress(offset)
            }
            request("POST", "/v1/files/finish", JSONObject().put("id", id), true)
        } catch (error: Exception) {
            runCatching { request("POST", "/v1/files/cancel", JSONObject().put("id", id), true) }
            throw error
        }
    }

    fun receiveFile(file: JSONObject, output: java.io.OutputStream, progress: (Long) -> Unit) {
        val size = file.getLong("size")
        val id = file.getString("id")
        var offset = 0L
        require(size in 0..8L * 1024 * 1024 * 1024)
        while (offset < size) {
            val chunk = request("POST", "/v1/files/chunk", JSONObject().put("id", id).put("offset", offset), true)
            check(chunk.getLong("offset") == offset && chunk.getLong("size") == size)
            val bytes = Base64.decode(chunk.getString("data"), Base64.NO_WRAP)
            check(bytes.isNotEmpty() && bytes.size <= 256 * 1024 && offset + bytes.size <= size)
            output.write(bytes)
            offset += bytes.size
            progress(offset)
        }
        output.flush()
    }

    // The receiver acknowledges only after closing and publishing the local download.
    fun finishReceivedFile(id: String) {
        request("POST", "/v1/files/finish", JSONObject().put("id", id), true)
    }

    fun sync(): EonSyncReport {
        check(isPaired) { "Önce cihazını eşleştir." }
        var sent = 0
        var received = 0
        var duplicated = 0
        var conflicts = 0
        repeat(20) {
            // 1. Our missing ops to PC, with acknowledgment only after desktop SQLite commits.
            val remoteManifest = request("GET", "/v1/notes/manifest", null, true)
            val outgoing = repository.deltaFor(remoteManifest)
            val opsOut = outgoing.getJSONArray("operations").length()
            if (opsOut > 0) {
                request("POST", "/v1/notes/apply", outgoing, true)
                sent += opsOut
            }

            // 2. PC missing ops to phone. Android SQLite commits before moving to next batch.
            val localManifest = repository.manifest()
            val incoming = request("POST", "/v1/notes/delta", localManifest, true)
            val opsIn = incoming.getJSONArray("operations").length()
            if (opsIn > 0) {
                val result: SyncApplyResult = repository.receiveDelta(incoming)
                received += result.applied
                duplicated += result.duplicates
                conflicts = result.conflictedNotes
            }
            if (opsOut == 0 && opsIn == 0) return EonSyncReport(sent, received, duplicated, conflicts)
        }
        error("Senkronizasyon büyük defter limitine ulaştı; devam etmeden önce tekrar eşitle.")
    }

    private fun request(method: String, pathname: String, json: JSONObject?, authorised: Boolean, endpoint: String = currentBaseUrl): JSONObject {
        val body = json?.toString()?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        require(body.size <= 32 * 1024 * 1024) { "Bu not güncellemesi tek isteğe sığmıyor. Not cihazda korunuyor." }
        val builder = Request.Builder().url(endpoint + pathname)
            .header("Cache-Control", "no-store")
        if (authorised) {
            val secret = keystore.getSecret() ?: error("Eşleştirme anahtarı bulunamadı")
            val now = System.currentTimeMillis().toString()
            val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }
            val digest = CanonicalNotes.sha256(String(body, Charsets.UTF_8))
            val signingText = "$method\n$pathname\n$now\n$nonce\n$digest"
            val keyBytes = Base64.decode(secret, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(keyBytes, "HmacSHA256")) }
            val signature = mac.doFinal(signingText.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }
            builder.header("X-Eon-Device", repository.deviceId)
                .header("X-Eon-Time", now).header("X-Eon-Nonce", nonce).header("X-Eon-Signature", signature)
        }
        if (method == "POST") builder.post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
        else builder.get()
        (if (pathname == "/v1/ai/send") aiHttp else http).newCall(builder.build()).execute().use { response ->
            val payload = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                if (pathname == "/v1/deck/layout" && response.code == 409) {
                    val current = runCatching {
                        val conflict = JSONObject(payload)
                        conflict.optJSONObject("layout") ?: conflict.optJSONObject("current")
                            ?: conflict.takeIf { it.has("widgets") }
                    }.getOrNull()
                    throw EonDeckConflictException(current)
                }
                if (response.code == 404 && (pathname.startsWith("/v1/files/") || pathname.startsWith("/v1/actions/") || pathname.startsWith("/v1/power/") || pathname.startsWith("/v1/deck") || pathname.startsWith("/v1/ai/"))) {
                    error("Bilgisayarda açık Eon bu özelliği desteklemiyor. Yeni masaüstü sürümünü açıp tekrar dene.")
                }
                if (response.code == 401) throw EonAccessDeniedException()
                val error = runCatching { JSONObject(payload).optString("error") }.getOrNull()
                throw IllegalStateException("Eon bağlantısı: HTTP ${response.code}${if (error.isNullOrBlank()) "" else " · $error"}")
            }
            // Only this endpoint permits a literal JSON null as its successful response.
            if (pathname == "/v1/ai/pending" && payload.trim() == "null") return JSONObject()
            return JSONObject(payload)
        }
    }
}

private fun JSONArray.stringItems(): List<String> = (0 until length()).mapNotNull { index ->
    optString(index).trim().takeIf(String::isNotEmpty)
}

/** Windows-issued pairing secrets are encrypted at rest by Android Keystore AES-GCM. */
private class LocalSecretStore(context: Context) {
    private val preferences = context.getSharedPreferences("eon2-secret", Context.MODE_PRIVATE)
    private val alias = "eon2-device-link-v1"
    // Polling screens authenticate several times per second. Decrypt once per client,
    // without ever storing the plaintext in SharedPreferences.
    @Volatile private var cachedSecret: String? = null

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    @Synchronized fun saveSecret(value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val encoded = Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
        check(preferences.edit().putString("encryptedSecret", encoded).commit()) { "Anahtar kaydedilemedi" }
        cachedSecret = value
    }

    fun getSecret(): String? {
        cachedSecret?.let { return it }
        return synchronized(this) {
            cachedSecret?.let { return@synchronized it }
            val stored = preferences.getString("encryptedSecret", null) ?: return@synchronized null
            val decrypted = try {
                val payload = Base64.decode(stored, Base64.NO_WRAP)
                if (payload.size < 29) null
                else {
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, payload.copyOfRange(0, 12)))
                    String(cipher.doFinal(payload.copyOfRange(12, payload.size)), Charsets.UTF_8)
                }
            } catch (_: Exception) { null }
            cachedSecret = decrypted
            decrypted
        }
    }

    @Synchronized fun removeSecret() {
        check(preferences.edit().remove("encryptedSecret").commit())
        cachedSecret = null
    }
}
