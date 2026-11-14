package com.kapanis.mobil.eon2.ui

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateCentroidSize
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Keyboard
import androidx.compose.material.icons.rounded.ScreenRotation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.viewinterop.AndroidView
import com.kapanis.mobil.eon2.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToInt

private data class PcRemoteAttempt(val display: PcDisplay, val quality: PcQuality, val control: Boolean,
    val id: String = UUID.randomUUID().toString())

private data class PcViewport(val scale: Float = 1f, val offset: Offset = Offset.Zero) {
    fun point(position: Offset, size: IntSize): Offset {
        val center = Offset(size.width / 2f, size.height / 2f)
        val unscaled = (position - center - offset) / scale + center
        return Offset((unscaled.x / size.width).coerceIn(0f, 1f), (unscaled.y / size.height).coerceIn(0f, 1f))
    }

    fun transform(anchor: Offset, pan: Offset, zoom: Float, size: IntSize): PcViewport {
        val next = (scale * zoom).coerceIn(1f, 3f)
        val center = Offset(size.width / 2f, size.height / 2f)
        val moved = anchor - center - (anchor - center - offset) * (next / scale) + pan
        val limit = center * (next - 1f)
        return PcViewport(next, Offset(moved.x.coerceIn(-limit.x, limit.x), moved.y.coerceIn(-limit.y, limit.y)))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PcRemoteScreen(client: EonUsbClient, peer: EonPeerStatus, foreground: Boolean,
    onBack: () -> Unit, onRotate: () -> Unit) {
    val ready = peer.connected && peer.paired
    val connection = remember(client, ready, peer.transport) { client.remoteDesktop() }
    val main = remember { Handler(Looper.getMainLooper()) }
    var status by remember(connection) { mutableStateOf<PcRemoteStatus?>(null) }
    var selected by rememberSaveable { mutableStateOf<Long?>(null) }
    var quality by rememberSaveable { mutableStateOf(PcQuality.Balanced) }
    var requestControl by rememberSaveable { mutableStateOf(true) }
    var trackpad by rememberSaveable { mutableStateOf(false) }
    var attempt by remember(connection) { mutableStateOf<PcRemoteAttempt?>(null) }
    var surface by remember { mutableStateOf<Surface?>(null) }
    var format by remember(attempt) { mutableStateOf<PcVideoFormat?>(null) }
    var visible by remember(attempt) { mutableStateOf(false) }
    var control by remember(attempt) { mutableStateOf(false) }
    var keyboard by remember(attempt) { mutableStateOf(false) }
    var phase by remember(attempt) { mutableStateOf("PC’de onay bekleniyor…") }
    var notice by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    val events = remember(attempt) { PcInputQueue() }

    LaunchedEffect(connection, ready, foreground, refresh, attempt?.id) {
        if (attempt != null || !foreground || !ready) return@LaunchedEffect
        try {
            val next = connection.status()
            status = next
            if (next.displays.none { it.id == selected }) selected = next.displays.firstOrNull()?.id
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { notice = error.message ?: "PC ekran paylaşımı kullanılamıyor." }
    }
    LaunchedEffect(foreground) {
        if (!foreground && attempt != null) {
            attempt = null
            notice = "Uygulama arka plana geçtiği için ekran paylaşımı kapandı."
        }
    }
    val current = attempt
    LaunchedEffect(current, surface, foreground, connection) {
        val target = surface ?: return@LaunchedEffect
        if (current == null || !foreground || !ready) return@LaunchedEffect
        try {
            connection.request(current.id, current.display, current.quality, current.control)
            withTimeout(33_000) {
                while (true) {
                    val state = connection.status()
                    check(state.id == current.id) { "PC ekran paylaşımı isteği sona erdi." }
                    if (state.state == "approved") break
                    check(state.state == "pending") { state.reason ?: "PC ekran paylaşımı isteği sona erdi." }
                    delay(350)
                }
            }
            phase = "PC ekranı açılıyor…"
            notice = null
            val reason = coroutineScope {
                val heartbeat = launch {
                    val startedAt = SystemClock.elapsedRealtime()
                    while (isActive) {
                        delay(1000)
                        check(visible || SystemClock.elapsedRealtime() - startedAt < 9000) {
                            "Telefonda PC görüntüsü başlatılamadı."
                        }
                        val state = connection.status()
                        check(state.id == current.id && state.state == "streaming") {
                            state.reason ?: "PC ekranı bağlantısı kapandı."
                        }
                    }
                }
                val sender = launch {
                    var sequence = 0L
                    for (signal in events.signal) {
                        if (!control) { events.clear(); continue }
                        val packet = events.drain()
                        if (packet.length() == 0) continue
                        try { connection.input(current.id, sequence++, packet) }
                        catch (error: PcRemoteHttpError) {
                            if (error.code != 409 && error.code != 429) throw error
                            control = false
                            keyboard = false
                            notice = error.message ?: "PC fare ve klavye girişini durdurdu."
                            events.clear()
                        }
                        delay(16)
                    }
                }
                try {
                    connection.stream(current.id, target,
                        onFormat = { next -> main.post {
                            if (attempt == current) { format = next; control = next.control }
                        } },
                        onVisible = { main.post { if (attempt == current) visible = true } },
                        onControlRevoked = { main.post {
                            if (attempt == current) {
                                control = false
                                keyboard = false
                                events.clear()
                                notice = "PC fare ve klavye erişimini kapattı."
                            }
                        } })
                } finally {
                    heartbeat.cancel()
                    sender.cancel()
                }
            }
            notice = reason
        } catch (_: TimeoutCancellationException) {
            notice = "PC ekran paylaşımı isteğinin süresi doldu."
        } catch (cancelled: CancellationException) {
            if (attempt == current && surface !== target) {
                attempt = null
                notice = "Video yüzeyi değişti. PC ekranına yeniden bağlan."
            }
            throw cancelled
        } catch (error: Exception) {
            notice = error.message ?: "PC ekranı bağlantısı kesildi."
        } finally {
            if (attempt == current) attempt = null
            withContext(NonCancellable) { runCatching { connection.stop(current.id) } }
        }
    }

    BackHandler {
        if (attempt != null) {
            attempt = null
            notice = "Ekran paylaşımı bitirildi."
        } else onBack()
    }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Geri") }
            Column(Modifier.weight(1f)) {
                Text("PC ekranı", style = MaterialTheme.typography.titleLarge)
                if (attempt != null) Text(
                    if (visible) if (control) "Görüntü ve kontrol" else "Yalnızca görüntü" else phase,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            IconButton(onClick = onRotate) { Icon(Icons.Rounded.ScreenRotation, "Ekranı döndür") }
            if (attempt != null) TextButton(onClick = {
                attempt = null
                notice = "Ekran paylaşımı bitirildi."
            }) { Text(if (visible) "Bitir" else "İptal") }
        }
        notice?.let { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall) }
        if (attempt != null) {
            PcVideoSurface(format, visible, control, trackpad, events, Modifier.weight(1f)) { surface = it }
            if (visible && control) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { trackpad = !trackpad }) { Text(if (trackpad) "Dokunmatik yüzey" else "Doğrudan dokunma") }
                    IconButton(onClick = { keyboard = true }) { Icon(Icons.Rounded.Keyboard, "Klavye ve kısayollar") }
                    TextButton(onClick = { events.add(keys("ESC")) }) { Text("Esc") }
                    TextButton(onClick = { events.add(keys("ENTER")) }) { Text("Enter") }
                }
            }
        } else {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    !ready -> Text("PC ekranını açmak için telefonu Eon ile eşleştir ve USB veya Tailscale üzerinden bağlan.")
                    status?.supported == false -> Text("PC ekran paylaşımı Windows’ta kullanılabilir.")
                    status == null && notice != null -> OutlinedButton(shape = MaterialTheme.shapes.medium, onClick = { notice = null; refresh++ }) { Text("Tekrar dene") }
                    status == null -> CircularProgressIndicator(Modifier.size(24.dp))
                    else -> {
                        Text("Paylaşılacak ekran", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            status?.displays?.forEach { display ->
                                FilterChip(selected == display.id, { selected = display.id }, { Text(display.name) })
                            }
                        }
                        Text("Görüntü kalitesi", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PcQuality.entries.forEach { option ->
                                FilterChip(quality == option, { quality = option }, { Text(option.label) })
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Fare ve klavye erişimi iste", Modifier.weight(1f))
                            Switch(checked = requestControl, onCheckedChange = { requestControl = it })
                        }
                        val display = status?.displays?.firstOrNull { it.id == selected }
                        Button(shape = MaterialTheme.shapes.medium, enabled = display != null, onClick = {
                            if (display != null) {
                                notice = null
                                attempt = PcRemoteAttempt(display, quality, requestControl)
                            }
                        }) { Text("PC’den onay iste") }
                        Text("Onayı bilgisayarda ver. Her oturum en fazla 30 dakika sürer.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
    if (keyboard && control) PcRemoteKeyboard(onClose = { keyboard = false }, send = events::add)
}

@Composable
private fun PcVideoSurface(format: PcVideoFormat?, visible: Boolean, control: Boolean, trackpad: Boolean,
    events: PcInputQueue, modifier: Modifier, onSurface: (Surface?) -> Unit) {
    val surfaceCallback by rememberUpdatedState(onSurface)
    BoxWithConstraints(modifier.fillMaxWidth().background(Color.Black), contentAlignment = Alignment.Center) {
        val ratio = (format?.width?.toFloat() ?: 16f) / (format?.height?.toFloat() ?: 9f)
        val videoWidth = minOf(maxWidth, maxHeight * ratio)
        var viewport by remember(videoWidth, ratio) { mutableStateOf(PcViewport()) }
        Box(Modifier.size(videoWidth, videoWidth / ratio)) {
            AndroidView(
                factory = { context ->
                    val video = SurfaceView(context).apply {
                        keepScreenOn = true
                        holder.addCallback(object : SurfaceHolder.Callback {
                            override fun surfaceCreated(holder: SurfaceHolder) = surfaceCallback(holder.surface)
                            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit
                            override fun surfaceDestroyed(holder: SurfaceHolder) = surfaceCallback(null)
                        })
                    }
                    FrameLayout(context).apply {
                        addView(video, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                    }
                },
                update = { frame ->
                    val video = frame.getChildAt(0)
                    video.scaleX = viewport.scale
                    video.scaleY = viewport.scale
                    video.translationX = viewport.offset.x
                    video.translationY = viewport.offset.y
                },
                modifier = Modifier.fillMaxSize().testTag("pc-video"),
            )
            if (visible) Box(Modifier.fillMaxSize().pointerInput(control, trackpad, events) {
                fun point(position: Offset) = viewport.point(position, size)
                awaitEachGesture {
                    val down = awaitFirstDown()
                    var dragged = false
                    var held = false
                    var multi = false
                    var multiMoved = false
                    var multiAnchor = down.position
                    var scroll = Offset.Zero
                    var fractionalMotion = Offset.Zero
                    var zoomGesture = false
                    var startSpan: Float? = null
                    try {
                        do {
                            val event = awaitPointerEvent()
                            val fingers = event.changes.filter { it.pressed && it.previousPressed }
                            if (event.changes.count { it.pressed } >= 2 || multi) {
                                multi = true
                                if (held) { events.add(event("release")); held = false }
                                if (fingers.size >= 2) {
                                    val span = event.calculateCentroidSize()
                                    if (startSpan == null) startSpan = event.calculateCentroidSize(useCurrent = false)
                                    val pan = event.calculatePan()
                                    zoomGesture = zoomGesture || !control || viewport.scale > 1f ||
                                        abs(span - startSpan) >= 10.dp.toPx()
                                    if (zoomGesture) {
                                        multiMoved = true
                                        viewport = viewport.transform(event.calculateCentroid(useCurrent = false), pan, event.calculateZoom(), size)
                                    } else {
                                        scroll += pan
                                        val step = 36.dp.toPx()
                                        if (abs(scroll.x) >= step || abs(scroll.y) >= step) {
                                            if (!multiMoved && !trackpad) events.add(position("move", point(event.calculateCentroid())))
                                            multiMoved = true
                                            val x = (scroll.x / step).toInt().coerceIn(-8, 8)
                                            val y = (scroll.y / step).toInt().coerceIn(-8, 8)
                                            events.add(delta("wheel", -x, y))
                                            scroll -= Offset(x * step, y * step)
                                        }
                                    }
                                    multiAnchor = event.calculateCentroid()
                                } else if (control && !multiMoved && event.changes.none { it.pressed }) {
                                    events.add(if (trackpad) button("click", "right") else pointer(point(multiAnchor), "click", "right"))
                                }
                                event.changes.forEach { it.consume() }
                                continue
                            }
                            val finger = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!control) {
                                if (finger.pressed && viewport.scale > 1f) {
                                    viewport = viewport.transform(finger.previousPosition, finger.position - finger.previousPosition, 1f, size)
                                }
                                finger.consume()
                                continue
                            }
                            if (!finger.pressed) {
                                if (held) {
                                    events.add(if (trackpad) button("up") else pointer(point(finger.position), "up"))
                                    held = false
                                }
                                else if (!dragged) {
                                    val mouseButton = if (finger.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis) "right" else "left"
                                    events.add(if (trackpad) button("click", mouseButton) else pointer(point(finger.position), "click", mouseButton))
                                }
                            } else if (dragged || (finger.position - down.position).getDistance() > viewConfiguration.touchSlop) {
                                if (!dragged && !trackpad) {
                                    events.add(pointer(point(down.position), "down"))
                                    held = true
                                }
                                if (!dragged && trackpad && finger.uptimeMillis - down.uptimeMillis >= 180) {
                                    events.add(button("down"))
                                    held = true
                                }
                                dragged = true
                                if (trackpad) {
                                    val motion = (finger.position - finger.previousPosition) / density + fractionalMotion
                                    val x = motion.x.roundToInt()
                                    val y = motion.y.roundToInt()
                                    fractionalMotion = motion - Offset(x.toFloat(), y.toFloat())
                                    if (x != 0 || y != 0) events.add(delta("relative", x.coerceIn(-128, 128), y.coerceIn(-128, 128)))
                                } else events.add(position("move", point(finger.position)))
                            }
                            finger.consume()
                        } while (event.changes.any { it.pressed })
                    } finally { if (held) events.add(event("release")) }
                }
            })
        }
        if (viewport.scale > 1f) {
            FilledTonalIconButton(onClick = { viewport = PcViewport() }, modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)) {
                Text("1×")
            }
        }
        if (!visible) CircularProgressIndicator(Modifier.size(26.dp), color = Color.White)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PcRemoteKeyboard(onClose: () -> Unit, send: (JSONObject) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onClose, title = { Text("PC klavyesi") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(text, { text = it.take(256) }, label = { Text("PC’ye yaz") }, modifier = Modifier.fillMaxWidth())
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((label, chord) in listOf(
                    "Esc" to listOf("ESC"), "Tab" to listOf("TAB"), "Enter" to listOf("ENTER"),
                    "Sil" to listOf("BACKSPACE"), "↑" to listOf("UP"), "↓" to listOf("DOWN"),
                    "←" to listOf("LEFT"), "→" to listOf("RIGHT"), "Win" to listOf("META"),
                    "Alt+Tab" to listOf("ALT", "TAB"), "Ctrl+C" to listOf("CTRL", "C"),
                    "Ctrl+V" to listOf("CTRL", "V"), "Ctrl+Z" to listOf("CTRL", "Z"),
                )) TextButton(onClick = { send(keys(*chord.toTypedArray())) }) { Text(label) }
            }
        }
    }, confirmButton = {
        TextButton(enabled = text.isNotEmpty(), onClick = { send(event("text").put("text", text)); text = "" }) { Text("Yaz") }
    }, dismissButton = { TextButton(onClick = onClose) { Text("Kapat") } })
}

private class PcInputQueue {
    val signal = Channel<Unit>(Channel.CONFLATED)
    private val queue = ArrayDeque<JSONObject>()
    fun clear() = queue.clear()

    fun add(next: JSONObject) {
        val type = next.getString("type")
        val last = queue.lastOrNull()
        if (last?.optString("type") == type) {
            if (type == "move") queue.removeLast()
            if (type == "relative" || type == "wheel") {
                val limit = if (type == "relative") 128 else 8
                val x = last.getInt("dx") + next.getInt("dx")
                val y = last.getInt("dy") + next.getInt("dy")
                if (abs(x) <= limit && abs(y) <= limit) {
                    queue.removeLast()
                    next.put("dx", x).put("dy", y)
                }
            }
        }
        if (queue.size >= 32) {
            queue.clear()
            queue.addLast(event("release"))
        } else queue.addLast(next)
        signal.trySend(Unit)
    }

    fun drain() = JSONArray().apply {
        repeat(minOf(16, queue.size)) { put(queue.removeFirst()) }
        if (queue.isNotEmpty()) signal.trySend(Unit)
    }
}

private fun event(type: String) = JSONObject().put("type", type)
private fun delta(type: String, x: Int, y: Int) = event(type).put("dx", x).put("dy", y)
private fun keys(vararg chord: String) = event("keys").put("keys", JSONArray(chord.toList()))
private fun position(type: String, point: Offset) = event(type).put("x", point.x.toDouble()).put("y", point.y.toDouble())
private fun pointer(point: Offset, action: String, button: String = "left") =
    position("pointer", point).put("action", action).put("button", button)
private fun button(action: String, name: String = "left") = event("button").put("action", action).put("button", name)
