package com.kapanis.mobil.eon2.network

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.Surface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.EOFException
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal data class PcDisplay(val id: Long, val name: String)
internal class PcRemoteHttpError(val code: Int, message: String) : IllegalStateException(message)
internal data class PcRemoteStatus(
    val supported: Boolean, val displays: List<PcDisplay>, val state: String, val id: String?, val reason: String?,
)
internal data class PcVideoFormat(val width: Int, val height: Int, val control: Boolean)
internal enum class PcQuality(val wire: String, val label: String) {
    Low("low", "Düşük veri"), Balanced("balanced", "Dengeli"), Sharp("sharp", "Keskin"),
}

internal class PcRemoteConnection(
    private val http: OkHttpClient,
    private val signedRequest: (String, JSONObject?) -> Request,
) {
    private val commands = http.newBuilder().callTimeout(2500, TimeUnit.MILLISECONDS).build()
    @Volatile private var preferCompatibleVideo = false
    private val avcDecoder by lazy {
        if (Build.VERSION.SDK_INT < 29) null else runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull { info ->
                !info.isEncoder && !info.isAlias && info.isHardwareAccelerated &&
                    MediaFormat.MIMETYPE_VIDEO_AVC in info.supportedTypes
            }?.name
        }.getOrNull()
    }

    suspend fun status(): PcRemoteStatus {
        val body = json("status", null)
        val displays = body.optJSONArray("displays") ?: JSONArray()
        return PcRemoteStatus(body.optBoolean("supported"), (0 until displays.length()).map { index ->
            val display = displays.getJSONObject(index)
            PcDisplay(display.getLong("id"), display.getString("name"))
        }, body.getString("state"), body.optString("id").ifBlank { null }, body.optString("reason").ifBlank { null })
    }

    suspend fun request(id: String, display: PcDisplay, quality: PcQuality, control: Boolean) {
        val preferAvc = withContext(Dispatchers.IO) { !preferCompatibleVideo && avcDecoder != null }
        json("request", session(id).put("display", display.id).put("quality", quality.wire).put("control", control).put("avc", preferAvc))
    }

    suspend fun input(id: String, sequence: Long, events: JSONArray) {
        json("input", session(id).put("sequence", sequence).put("events", events))
    }

    suspend fun stop(id: String) { json("stop", session(id)) }

    suspend fun stream(id: String, surface: Surface, onFormat: (PcVideoFormat) -> Unit, onVisible: () -> Unit,
        onControlRevoked: () -> Unit): String = exchange(http, "stream", session(id)) { response ->
        val codec = when (response.header("content-type")) {
            "application/vnd.eon.remote-vp8" -> null
            "application/vnd.eon.remote-avc" -> checkNotNull(avcDecoder) { "Telefonun donanım video çözücüsü kullanılamıyor." }
            else -> error("PC video protokolü uyuşmuyor.")
        }
        val width = response.header("x-eon-width")?.toIntOrNull() ?: 0
        val height = response.header("x-eon-height")?.toIntOrNull() ?: 0
        check(width in 16..1920 && height in 16..1920) { "PC video boyutu geçersiz." }
        onFormat(PcVideoFormat(width, height, response.header("x-eon-control") == "1"))
        val input = DataInputStream(checkNotNull(response.body).byteStream())
        try {
            decode(input, surface, width, height, codec, onVisible, onControlRevoked)
        } catch (failure: RuntimeException) {
            if (codec == null || failure is CancellationException || !surface.isValid) throw failure
            preferCompatibleVideo = true
            throw IllegalStateException("Donanım video çözücüsü çalışmadı. Yeniden bağlanırsan uyumlu video kullanılacak.", failure)
        }
    }

    private suspend fun json(operation: String, body: JSONObject?) = exchange(commands, operation, body) { response ->
        JSONObject(response.body?.string().orEmpty())
    }

    private suspend fun <T> exchange(client: OkHttpClient, operation: String, body: JSONObject?, read: (Response) -> T): T =
        coroutineScope {
            val call = withContext(Dispatchers.IO) { client.newCall(signedRequest(operation, body)) }
            val cancel = launch(start = CoroutineStart.UNDISPATCHED) {
                try { awaitCancellation() } finally { call.cancel() }
            }
            try {
                withContext(Dispatchers.IO) {
                    call.execute().use { response ->
                        if (!response.isSuccessful) {
                            val message = if (response.code == 404) "PC’deki Eon’u ekran paylaşımını destekleyen sürüme güncelle."
                            else if (response.code == 401) "Telefonun eşleştirmesi doğrulanamadı."
                            else runCatching { JSONObject(response.body?.string().orEmpty()).getString("error") }
                                .getOrDefault("PC ekranı isteği başarısız oldu (${response.code}).")
                            throw PcRemoteHttpError(response.code, message)
                        }
                        read(response)
                    }
                }
            } finally { cancel.cancel() }
        }

    private fun session(id: String) = JSONObject().put("id", id)
}

private const val MAX_FRAME = 1024 * 1024

private fun decode(input: DataInputStream, surface: Surface, width: Int, height: Int, avcDecoder: String?,
    onVisible: () -> Unit, onControlRevoked: () -> Unit): String {
    val frame = ByteArray(MAX_FRAME)
    val mime = if (avcDecoder == null) MediaFormat.MIMETYPE_VIDEO_VP8 else MediaFormat.MIMETYPE_VIDEO_AVC
    val format = MediaFormat.createVideoFormat(mime, width, height)
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MAX_FRAME)
    if (Build.VERSION.SDK_INT >= 30) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
    var firstLength = 0
    if (avcDecoder != null) {
        firstLength = input.readInt()
        check(input.readUnsignedByte() == 1 && firstLength in 1..MAX_FRAME) { "İlk PC video karesi geçersiz." }
        input.readFully(frame, 0, firstLength)
        format.setByteBuffer("csd-0", avcParameterSet(frame, firstLength, 7))
        format.setByteBuffer("csd-1", avcParameterSet(frame, firstLength, 8))
    }
    val decoder = if (avcDecoder == null) MediaCodec.createDecoderByType(mime) else MediaCodec.createByCodecName(avcDecoder)
    val callbacks = HandlerThread("EonPcVideo").apply { start() }
    val available = LinkedBlockingQueue<Int>(32)
    val error = AtomicReference<Exception?>()
    val firstOutput = AtomicBoolean(true)
    var started = false
    try {
        decoder.setCallback(object : MediaCodec.Callback() {
            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
                if (!available.offer(index)) error.set(IllegalStateException("PC video kuyruğu doldu."))
            }
            override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
                try {
                    codec.releaseOutputBuffer(index, true)
                    if (firstOutput.getAndSet(false)) onVisible()
                } catch (failure: IllegalStateException) { error.set(failure) }
            }
            override fun onError(codec: MediaCodec, failure: MediaCodec.CodecException) { error.set(failure) }
            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) = Unit
        }, Handler(callbacks.looper))
        decoder.configure(format, surface, null, 0)
        decoder.start()
        started = true
        val startedAt = SystemClock.elapsedRealtime()
        var needsKey = true
        var frameNumber = 0L
        while (true) {
            error.get()?.let { throw IllegalStateException("Telefon PC videosunu çözemedi.", it) }
            check(!firstOutput.get() || SystemClock.elapsedRealtime() - startedAt < 6000) {
                "Telefon ilk PC video karesini çözemedi."
            }
            val buffered = firstLength > 0
            val length = if (buffered) firstLength else try {
                input.readInt()
            } catch (_: EOFException) { return "PC ekranı bağlantısı kapandı." }
            val type = if (buffered) 1 else input.readUnsignedByte()
            firstLength = 0
            check(length in 0..MAX_FRAME) { "Geçersiz PC video paketi." }
            when (type) {
                0, 3 -> {
                    check(length == 0) { "Geçersiz PC kontrol paketi." }
                    if (type == 3) onControlRevoked()
                }
                4 -> {
                    check(length in 1..1024) { "Geçersiz PC kapanış paketi." }
                    input.readFully(frame, 0, length)
                    return String(frame, 0, length, Charsets.UTF_8)
                }
                1, 2 -> {
                    check(length > 0) { "Boş PC video karesi." }
                    if (!buffered) input.readFully(frame, 0, length)
                    if (needsKey && type != 1) continue
                    val index = available.poll(24, TimeUnit.MILLISECONDS)
                    if (index == null) { needsKey = true; continue }
                    needsKey = false
                    val buffer = checkNotNull(decoder.getInputBuffer(index))
                    buffer.clear()
                    check(buffer.remaining() >= length) { "PC video karesi telefonun kod çözücüsüne sığmıyor." }
                    buffer.put(frame, 0, length)
                    decoder.queueInputBuffer(index, 0, length, frameNumber++ * 33_333L,
                        if (type == 1) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                }
                else -> error("Bilinmeyen PC video paketi.")
            }
        }
    } finally {
        // Stop callbacks before the codec releases its Surface and buffers.
        callbacks.quitSafely()
        callbacks.join()
        if (started) runCatching { decoder.stop() }
        decoder.release()
    }
}

private fun avcParameterSet(frame: ByteArray, length: Int, type: Int): ByteBuffer {
    fun startCode(from: Int): Int {
        for (index in from until length - 2) {
            if (frame[index].toInt() == 0 && frame[index + 1].toInt() == 0 &&
                (frame[index + 2].toInt() == 1 ||
                    (index + 3 < length && frame[index + 2].toInt() == 0 && frame[index + 3].toInt() == 1))) return index
        }
        return length
    }
    var start = startCode(0)
    while (start < length) {
        val payload = start + if (frame[start + 2].toInt() == 1) 3 else 4
        if (payload >= length) break
        val end = startCode(payload + 1)
        if (frame[payload].toInt() and 0x1f == type) {
            return ByteBuffer.allocate(4 + end - payload).putInt(1).put(frame, payload, end - payload).apply { flip() }
        }
        start = end
    }
    error("H.264 ekran verisinde gerekli parametre bulunamadı.")
}
