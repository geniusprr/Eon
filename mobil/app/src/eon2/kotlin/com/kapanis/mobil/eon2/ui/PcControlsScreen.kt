package com.kapanis.mobil.eon2.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.VolumeDown
import androidx.compose.material.icons.automirrored.rounded.VolumeMute
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.kapanis.mobil.eon2.network.EonUsbClient
import com.kapanis.mobil.eon2.network.ReceivedDownload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Locale
import java.util.UUID

private val accentMint = Color(0xFF7BD2A4)
private val accentBlue = Color(0xFF8BBFF9)
private val accentViolet = Color(0xFFBBA8FA)
private val accentAmber = Color(0xFFF3C187)
private val accentRed = Color(0xFFFFA5A5)
private val controlShape = RoundedCornerShape(22.dp)

private data class PhoneAction(
    val id: String, val name: String, val kind: String, val target: String,
    val arguments: List<String>, val delaySeconds: Long, val remoteEnabled: Boolean,
) {
    companion object {
        fun read(json: JSONObject) = PhoneAction(
            json.getString("id"), json.getString("name"), json.getString("kind"),
            json.optString("target"), json.optJSONArray("arguments")?.let { array ->
                (0 until array.length()).map { array.getString(it) }
            }.orEmpty(), json.optLong("delaySeconds"), json.optBoolean("remoteEnabled"),
        )
    }
}

private data class PhoneFile(
    val id: String, val name: String, val size: Long, val transferred: Long,
    val direction: String, val state: String,
    val download: ReceivedDownload? = null,
) {
    companion object {
        fun read(json: JSONObject) = PhoneFile(
            json.getString("id"), json.getString("fileName"), json.getLong("size"),
            json.optLong("transferred"), json.getString("direction"), json.getString("state"),
        )
    }
}

private data class PhoneTimer(val action: String, val shortcutId: String, val deadline: Long?)
private data class PhoneDeck(
    val shortcutsAllowed: Boolean, val powerAllowed: Boolean, val mediaAvailable: Boolean,
    val mediaTitle: String, val mediaArtist: String, val playing: Boolean?,
) {
    companion object {
        fun read(json: JSONObject): PhoneDeck {
            val media = json.optJSONObject("media")
            return PhoneDeck(json.optBoolean("shortcutsAllowed"), json.optBoolean("powerAllowed"),
                json.optBoolean("mediaAvailable"), media?.optString("title").orEmpty(),
                media?.optString("artist").orEmpty(), media?.optBoolean("playing"),
            )
        }
    }
}

private data class PendingUpload(val uri: Uri, val name: String, val size: Long)
private data class ActionDraft(
    val id: String? = null, val name: String = "", val kind: String = "application",
    val target: String = "", val argumentsText: String = "[]", val delayText: String = "60",
)

@Composable
internal fun PcControlsScreen(client: EonUsbClient, filesOnly: Boolean, modifier: Modifier = Modifier,
    bottomClearance: androidx.compose.ui.unit.Dp = 0.dp, receivedFiles: List<ReceivedDownload> = emptyList(),
    onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var actions by remember { mutableStateOf<List<PhoneAction>>(emptyList()) }
    var files by remember { mutableStateOf<List<PhoneFile>>(emptyList()) }
    var deck by remember { mutableStateOf<PhoneDeck?>(null) }
    var timer by remember { mutableStateOf<PhoneTimer?>(null) }
    var reloadRequest by remember { mutableIntStateOf(0) }
    var loaded by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf("") }
    var search by rememberSaveable(filesOnly) { mutableStateOf("") }
    var filter by rememberSaveable(filesOnly) { mutableStateOf("all") }
    var confirmAction by remember { mutableStateOf<PhoneAction?>(null) }
    var editing by remember { mutableStateOf<ActionDraft?>(null) }
    var editError by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        val request = ++reloadRequest
        if (filesOnly) {
            val result = withContext(Dispatchers.IO) { client.files() }
            if (request != reloadRequest) return
            val array = result.getJSONArray("files")
            files = (0 until array.length()).map { PhoneFile.read(array.getJSONObject(it)) }
        } else {
            val result = withContext(Dispatchers.IO) { client.controls() }
            if (request != reloadRequest) return
            val array = result.getJSONArray("actions")
            actions = (0 until array.length()).map { PhoneAction.read(array.getJSONObject(it)) }
            timer = result.optJSONObject("timer")?.let {
                PhoneTimer(it.getString("action"), it.optString("shortcutId"),
                    powerDeadline(it.getLong("targetAt"), result.optLong("sampledAt", System.currentTimeMillis())))
            }
            val latestDeck = try { withContext(Dispatchers.IO) { PhoneDeck.read(client.deck()) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null } // Device-level permissions and media are optional on older desktops.
            if (request != reloadRequest) return
            deck = latestDeck
        }
        loaded = true
        loadError = null
    }

    fun runOperation(success: String, work: suspend () -> Unit) {
        if (busy) return
        reloadRequest++
        busy = true
        progress = ""
        notice = null
        scope.launch {
            try {
                work()
                notice = success
                try { reload() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { loadError = error.message ?: "Liste yenilenemedi." }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { notice = error.message ?: "İşlem tamamlanamadı. PC izinlerini kontrol et." }
            finally { busy = false; progress = "" }
        }
    }

    fun executeAction(action: PhoneAction) {
        runOperation("${action.name} · Komut PC tarafından kabul edildi.") {
            withContext(Dispatchers.IO) { client.executeAction(action.id, action.kind) }
        }
    }

    fun refreshNow() {
        if (busy) return
        busy = true
        notice = null
        scope.launch {
            try { reload(); notice = "Liste yenilendi." }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { loadError = error.message ?: "Bilgiler alınamadı." }
            finally { busy = false }
        }
    }

    LaunchedEffect(filesOnly, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                if (!busy) {
                    try { reload() }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) { loadError = error.message ?: "Bilgiler alınamadı." }
                }
                delay(5000)
            }
        }
    }

    val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            try {
                val selection = withContext(Dispatchers.IO) {
                    var name: String? = null
                    var size = -1L
                    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            name = cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
                            val sizeColumn = cursor.getColumnIndexOrThrow(OpenableColumns.SIZE)
                            if (!cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
                        }
                    }
                    val fileName = name ?: error("Dosya adı okunamadı.")
                    require(fileName.length in 1..180 && fileName.none { it in "<>:\"/\\|?*" || it.code < 32 } &&
                        !fileName.endsWith('.') && !fileName.endsWith(' ') &&
                        !Regex("^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\\.|$)", RegexOption.IGNORE_CASE).containsMatchIn(fileName)) {
                        "Dosya adı Windows için uygun değil. Dosyayı yeniden adlandırıp seç."
                    }
                    require(size in 0..8L * 1024 * 1024 * 1024) { "Dosya boyutu bilinmeli ve 8 GB'ı geçmemeli." }
                    PendingUpload(uri, fileName, size)
                }
                runOperation("Dosya bilgisayara gönderildi.") {
                    withContext(Dispatchers.IO) {
                        val transferContext = currentCoroutineContext()
                        context.contentResolver.openInputStream(selection.uri)?.use { input ->
                            var lastProgressFrameAt = 0L
                            client.sendFile(selection.name, selection.size, input) { bytes ->
                                transferContext.ensureActive()
                                // Large transfers emit thousands of callbacks; render at most 5 updates/sec.
                                val now = SystemClock.elapsedRealtime()
                                if (bytes == selection.size || now - lastProgressFrameAt >= 200L) {
                                    lastProgressFrameAt = now
                                    scope.launch { progress = "${formatBytes(bytes)} / ${formatBytes(selection.size)}" }
                                }
                            }
                        } ?: error("Seçilen dosya açılamadı.")
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { notice = error.message ?: "Dosya okunamadı." }
        }
    }

    val filteredActions = actions.filter { action ->
        (filter == "all" || (filter == "ready" && action.remoteEnabled && (deck == null || actionAllowed(action, deck))) ||
            (filter == "pending" && (!action.remoteEnabled || (deck != null && !actionAllowed(action, deck))))) &&
            (search.isBlank() || action.name.contains(search, true) || actionKindLabel(action.kind).contains(search, true))
    }
    val transferHistory = remember(files, receivedFiles) {
        val savedIds = receivedFiles.mapTo(mutableSetOf()) { it.id }
        receivedFiles.map { PhoneFile(it.id, it.name, it.size, it.size, "send", "completed", it) } +
            files.asReversed().filterNot { it.id in savedIds }
    }
    val filteredFiles = transferHistory.filter { file ->
        (filter == "all" || (filter == "incoming" && file.direction == "send") ||
            (filter == "outgoing" && file.direction == "receive")) &&
            (search.isBlank() || file.name.contains(search, true))
    }

    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, bottom = bottomClearance + 28.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)) {
        item(key = "heading") {
            Column(verticalArrangement = Arrangement.spacedBy(13.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    if (!filesOnly) {
                        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Kontrol merkezine dön")
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        if (!filesOnly) {
                            Text("PC CONTROL DECK", style = MaterialTheme.typography.labelSmall,
                                letterSpacing = 1.5.sp, color = MaterialTheme.colorScheme.primary)
                        }
                        Text(if (filesOnly) "Local Send" else "PC kısayolları",
                            style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    }
                    IconButton(enabled = !busy, onClick = {
                        refreshNow()
                    }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.Refresh, "Listeyi yenile")
                    }
                }
                Text(if (filesOnly) "Telefon ile bilgisayar arasında doğrudan dosya aktar."
                    else "Uygulama aç, komut çalıştır ve bilgisayarının güç işlemlerini yönet.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                if (filesOnly) {
                    Button(enabled = !busy, onClick = { openDocument.launch(arrayOf("*/*")) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(16.dp)) {
                        Icon(Icons.Rounded.UploadFile, null, Modifier.size(19.dp))
                        Spacer(Modifier.width(9.dp)); Text("Dosya gönder")
                    }
                } else {
                    Button(enabled = !busy && loaded && loadError == null,
                        onClick = { editing = ActionDraft(); editError = null },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(16.dp)) {
                        Icon(Icons.Rounded.Add, null, Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp)); Text("Yeni kısayol oluştur")
                    }
                }
            }
        }

        if (busy) item(key = "busy") {
            Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(progress.ifBlank { "İşlem sürüyor…" }, style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
        if (notice != null || loadError != null) item(key = "feedback") {
            val error = if (filesOnly && loadError != null && receivedFiles.isNotEmpty()) {
                "PC’deki aktarım listesi alınamadı. Telefona kaydedilen dosyalar aşağıda."
            } else loadError
            ControlNotice(notice, error, onRetry = { refreshNow() })
        }
        if (!loaded && loadError == null) item(key = "loading") {
            Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(25.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp)); Text("PC bilgileri alınıyor…")
            }
        }
        if (!filesOnly && timer != null) item(key = "timer") {
            val scheduled = timer ?: return@item
            val countdown = powerCountdown(scheduled.deadline) ?: return@item
            val cancel = actions.firstOrNull { it.kind == "cancel" }
            Surface(shape = controlShape, color = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = .53f)) {
                Column(Modifier.fillMaxWidth().padding(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Rounded.Schedule, null, tint = MaterialTheme.colorScheme.onTertiaryContainer)
                        Column {
                            Text(if (scheduled.action == "shutdown") "Kapanış planlandı" else "Yeniden başlatma planlandı",
                                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(countdown, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (cancel != null) {
                        OutlinedButton(enabled = !busy && cancel.remoteEnabled && (deck == null || actionAllowed(cancel, deck)),
                            onClick = { confirmAction = cancel }) {
                            Icon(Icons.Rounded.TimerOff, null, Modifier.size(17.dp))
                            Spacer(Modifier.width(8.dp)); Text("Planı iptal et")
                        }
                    } else {
                        Text("İptal için PC’de bir ‘Güç planını iptal et’ kısayolu oluştur.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (!filesOnly && deck?.mediaAvailable == true) item(key = "media") {
            val media = deck!!
            Surface(modifier = Modifier.eonGlass(controlShape), shape = controlShape, color = Color.Transparent,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f))) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        ControlIcon(Icons.Rounded.GraphicEq, accentViolet)
                        Column(Modifier.weight(1f)) {
                            Text("Medya kontrolü", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                            Text(when {
                                !media.shortcutsAllowed -> "PC’den Kısayollar izni gerekli"
                                media.mediaTitle.isNotBlank() -> media.mediaTitle
                                else -> "Windows medya tuşları"
                            }, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (media.mediaArtist.isNotBlank()) Text(media.mediaArtist,
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    listOf(
                            Triple("previous", "Önceki parça", Icons.Rounded.SkipPrevious),
                            Triple("playPause", "Oynat veya duraklat", if (media.playing == true) Icons.Rounded.Pause else Icons.Rounded.PlayArrow),
                            Triple("next", "Sonraki parça", Icons.Rounded.SkipNext),
                            Triple("volumeDown", "Sesi azalt", Icons.AutoMirrored.Rounded.VolumeDown),
                            Triple("mute", "Sesi kapat veya aç", Icons.AutoMirrored.Rounded.VolumeMute),
                            Triple("volumeUp", "Sesi artır", Icons.AutoMirrored.Rounded.VolumeUp),
                        ).chunked(3).forEach { mediaRow ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly,
                                verticalAlignment = Alignment.CenterVertically) {
                                mediaRow.forEach { (id, label, image) ->
                                    IconButton(enabled = !busy && media.shortcutsAllowed,
                                        onClick = { runOperation("$label komutu PC’ye gönderildi.") {
                                            withContext(Dispatchers.IO) { client.executeDeckCommand(id) }
                                        } }, modifier = Modifier.size(48.dp)) {
                                        Icon(image, label, Modifier.size(23.dp))
                                    }
                                }
                            }
                        }
                }
            }
        }
        if (loaded || receivedFiles.isNotEmpty()) item(key = "filters") {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(if (filesOnly) "Aktarım listesi" else "Kısayollarım",
                        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(if (filesOnly) "${transferHistory.size} dosya" else "${actions.size} kısayol",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(value = search, onValueChange = { search = it },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    placeholder = { Text(if (filesOnly) "Dosya ara" else "Kısayol ara") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = { if (search.isNotBlank()) IconButton(onClick = { search = "" }) {
                        Icon(Icons.Rounded.Close, "Aramayı temizle") } },
                    shape = RoundedCornerShape(15.dp))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (if (filesOnly) listOf("all" to "Tümü", "incoming" to "PC’den gelen", "outgoing" to "PC’ye giden")
                    else listOf("all" to "Tümü", "ready" to "Kullanılabilir", "pending" to "İzin bekleyen"))
                        .forEach { (value, label) -> FilterChip(selected = filter == value, onClick = { filter = value },
                            label = { Text(label) }) }
                }
            }
        }
        if (loaded && !filesOnly && filteredActions.isEmpty()) item(key = "actions-empty") {
            EmptyControlState(Icons.Rounded.GridView,
                if (actions.isEmpty()) "Henüz kısayol yok" else "Eşleşen kısayol bulunamadı",
                if (actions.isEmpty()) "İlk kısayolunu oluştur. Cihaz iznin varsa buradan çalıştırabilirsin."
                else "Arama metnini veya filtreyi değiştir.")
        }
        if (filesOnly && (loaded || receivedFiles.isNotEmpty()) && filteredFiles.isEmpty()) item(key = "files-empty") {
            EmptyControlState(Icons.Rounded.FolderOpen,
                if (transferHistory.isEmpty()) "Aktarım kuyruğu boş" else "Eşleşen dosya bulunamadı",
                if (transferHistory.isEmpty()) "PC’den bu telefona dosya gönderilebilir veya yukarıdan bir dosya seçebilirsin."
                else "Arama metnini veya filtreyi değiştir.")
        }
        if (!filesOnly) items(filteredActions, key = { "action-${it.id}" }) { action ->
            val deadline = timer?.takeIf { it.shortcutId == action.id && it.action == action.kind }?.deadline
            val countdown = powerCountdown(deadline)
            ActionControlCard(action, deck, busy, countdown, onExecute = {
                if (countdown != null || isTimedPowerAction(action.kind, action.delaySeconds)) executeAction(action)
                else confirmAction = action
            }, onEdit = {
                editing = ActionDraft(action.id, action.name, action.kind, action.target,
                    JSONArray(action.arguments).toString(), action.delaySeconds.toString())
                editError = null
            })
        } else items(filteredFiles, key = { "file-${it.id}" }) { file ->
            FileControlCard(file)
        }
        item(key = "permission-hint") {
            Text(if (filesOnly) "Aktarım için PC → Cihazlar → Dosyalar izni açık olmalı. Gelen dosyalar Downloads’a, gönderilenler PC’deki Eon klasörüne otomatik kaydedilir."
                else "Yeni kısayollar telefon erişimiyle kaydedilir. Cihaz izni: PC → Cihazlar → Kısayollar / Güç.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
    }

    confirmAction?.let { action ->
        AlertDialog(onDismissRequest = { if (!busy) confirmAction = null },
            icon = { Icon(actionIcon(action.kind), null) },
            title = { Text(action.name) },
            text = { Text("${actionDescription(action)}\n\nBu işlem bilgisayarında çalıştırılacak. Onaylıyor musun?") },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                confirmAction = null
                executeAction(action)
            }) { Text(if (action.kind == "cancel") "Planı iptal et" else "Çalıştır") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { confirmAction = null }) { Text("Vazgeç") } })
    }
    editing?.let { draft ->
        val canSave = draft.name.isNotBlank() && !busy
        AlertDialog(onDismissRequest = { if (!busy) editing = null },
            title = { Text(if (draft.id == null) "Yeni kısayol" else "Kısayolu düzenle") },
            text = {
                Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(value = draft.name, onValueChange = { editing = draft.copy(name = it.take(80)); editError = null },
                        label = { Text("Kısayol adı") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text("Eylem türü", style = MaterialTheme.typography.labelLarge)
                    listOf(
                        listOf("application", "file"), listOf("command", "lock"),
                        listOf("shutdown", "restart"), listOf("cancel"),
                    ).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            row.forEach { value ->
                                FilterChip(selected = draft.kind == value,
                                    onClick = { editing = draft.copy(kind = value, target = if (value != draft.kind) "" else draft.target); editError = null },
                                    label = { Text(actionKindLabel(value), maxLines = 1) }, modifier = Modifier.weight(1f))
                            }
                            if (row.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                    if (draft.kind in listOf("application", "file", "command")) {
                        OutlinedTextField(value = draft.target,
                            onValueChange = { editing = draft.copy(target = it.take(4096)); editError = null },
                            label = { Text(when (draft.kind) {
                                "application" -> "Windows tam uygulama yolu (.exe)"
                                "file" -> "Windows dosya yolu"
                                else -> "PowerShell komutu"
                            }) }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 4)
                    }
                    if (draft.kind == "application") OutlinedTextField(value = draft.argumentsText,
                        onValueChange = { editing = draft.copy(argumentsText = it.take(65536)); editError = null },
                        label = { Text("Argümanlar (JSON dizisi)") },
                        supportingText = { Text("Örnek: [\"--help\"]") }, modifier = Modifier.fillMaxWidth())
                    if (draft.kind in listOf("shutdown", "restart")) OutlinedTextField(value = draft.delayText,
                        onValueChange = { editing = draft.copy(delayText = it.filter(Char::isDigit).take(6)); editError = null },
                        label = { Text("Gecikme (saniye)") },
                        supportingText = { Text("1 ile 604800 saniye arasında") },
                        modifier = Modifier.fillMaxWidth())
                    Text(if (draft.id == null) "Bu kısayol telefon erişimiyle kaydedilir."
                        else "Telefon erişimini PC’de Kısayollar bölümünden yönetebilirsin.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall)
                    editError?.let { Text(it, color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall) }
                }
            },
            confirmButton = { TextButton(enabled = canSave, onClick = {
                try {
                    val payload = validateDraft(draft)
                    runOperation("Kısayol kaydedildi.") {
                        withContext(Dispatchers.IO) { client.saveAction(payload) }
                        editing = null
                    }
                } catch (error: IllegalArgumentException) { editError = error.message }
                catch (error: Exception) { editError = error.message ?: "Kısayol geçersiz." }
            }) { Text("Kaydet") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { editing = null }) { Text("Vazgeç") } })
    }

}

@Composable
private fun ControlIcon(image: ImageVector, tint: Color) {
    val foreground = if (MaterialTheme.colorScheme.surface.luminance() > .5f) MaterialTheme.colorScheme.primary else tint
    Box(Modifier.size(42.dp).background(foreground.copy(alpha = .13f), RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center) {
        Icon(image, null, Modifier.size(22.dp), tint = foreground)
    }
}

@Composable
private fun ControlNotice(notice: String?, error: String?, onRetry: () -> Unit) {
    val problem = error != null
    Surface(shape = RoundedCornerShape(15.dp),
        color = if (problem) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) {
        Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Icon(if (problem) Icons.Rounded.Info else Icons.Rounded.CheckCircle, null, Modifier.size(20.dp))
            Text(listOfNotNull(notice, error).joinToString(" · "),
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodySmall)
            if (error != null) TextButton(onClick = onRetry) { Text("Tekrar dene") }
        }
    }
}

@Composable
private fun EmptyControlState(icon: ImageVector, heading: String, explanation: String) {
    Surface(shape = controlShape, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(vertical = 30.dp, horizontal = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ControlIcon(icon, MaterialTheme.colorScheme.primary)
            Text(heading, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(explanation, color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ActionControlCard(action: PhoneAction, deck: PhoneDeck?, busy: Boolean, countdown: String?,
    onExecute: () -> Unit, onEdit: () -> Unit) {
    val allowed = action.remoteEnabled && (deck == null || actionAllowed(action, deck))
    val permission = when {
        !action.remoteEnabled -> "Yalnızca PC"
        deck != null && !actionAllowed(action, deck) -> "Cihaz izni kapalı"
        deck == null -> "PC onaylı"
        else -> "Kullanılabilir"
    }
    Surface(modifier = Modifier.eonGlass(controlShape), shape = controlShape, color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f))) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                ControlIcon(actionIcon(action.kind), actionTint(action.kind))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(action.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(actionKindLabel(action.kind), style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Surface(shape = CircleShape,
                    color = if (allowed) accentMint.copy(alpha = .15f) else accentAmber.copy(alpha = .15f)) {
                    Text(permission, modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
                        fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurface)
                }
            }
            val description = actionDescription(action)
            if (description.isNotBlank()) Text(description, maxLines = 3, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Button(enabled = !busy && allowed, onClick = onExecute, modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    shape = RoundedCornerShape(13.dp)) {
                    Icon(if (countdown == null) Icons.Rounded.PlayArrow else Icons.Rounded.Stop, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp)); Text(if (countdown == null) "Çalıştır" else "Durdur · $countdown")
                }
                OutlinedButton(enabled = !busy, onClick = onEdit, modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    shape = RoundedCornerShape(13.dp)) {
                    Icon(Icons.Rounded.Edit, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(5.dp)); Text("Düzenle")
                }
            }
        }
    }
}

@Composable
private fun FileControlCard(file: PhoneFile) {
    val incoming = file.direction == "send"
    Surface(modifier = Modifier.eonGlass(controlShape), shape = controlShape, color = Color.Transparent,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .6f))) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ControlIcon(if (incoming) Icons.Rounded.Download else Icons.Rounded.UploadFile,
                    if (incoming) accentBlue else accentMint)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(file.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("${if (incoming) "PC → Telefon" else "Telefon → PC"} · ${formatBytes(file.size)}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Icon(when (file.state) {
                    "completed" -> Icons.Rounded.CheckCircle
                    "cancelled" -> Icons.Rounded.Cancel
                    "transferring" -> Icons.Rounded.Sync
                    else -> Icons.Rounded.Schedule
                }, null, Modifier.size(15.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(when (file.state) {
                    "queued" -> "Alınmayı bekliyor"
                    "transferring" -> "Aktarılıyor"
                    "completed" -> if (file.download != null) "Telefona kaydedildi" else "Tamamlandı"
                    "cancelled" -> "İptal edildi"
                    else -> "Durum bilinmiyor"
                }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (file.transferred > 0 && file.state == "transferring") {
                    Spacer(Modifier.weight(1f))
                    Text(formatBytes(file.transferred), style = MaterialTheme.typography.labelSmall)
                }
            }
            if (file.state == "transferring" && file.size > 0) {
                LinearProgressIndicator(progress = { (file.transferred.toFloat() / file.size).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth())
            }
            if (incoming && file.state in listOf("queued", "transferring")) {
                Text("Downloads klasörüne otomatik kaydediliyor.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            file.download?.let { ReceivedFileActions(it, Modifier.fillMaxWidth()) }
        }
    }
}

@Composable
private fun ReceivedFileActions(file: ReceivedDownload, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var checking by remember(file.id) { mutableStateOf(false) }
    var error by rememberSaveable(file.id) { mutableStateOf<String?>(null) }

    fun launchFile(share: Boolean) {
        checking = true
        error = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openFileDescriptor(file.uri, "r")?.close()
                        ?: throw IOException("Dosya açılamadı.")
                }
                val intent = Intent(if (share) Intent.ACTION_SEND else Intent.ACTION_VIEW).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if (share) {
                        type = file.mimeType
                        putExtra(Intent.EXTRA_STREAM, file.uri)
                        clipData = ClipData.newRawUri(file.name, file.uri)
                    } else {
                        setDataAndType(file.uri, file.mimeType)
                    }
                }
                context.startActivity(if (share) Intent.createChooser(intent, null) else intent)
            } catch (_: ActivityNotFoundException) {
                error = if (share) "Dosyayı paylaşacak bir uygulama bulunamadı." else
                    "Bu dosya türünü açacak bir uygulama bulunamadı. Dosyayı yine de paylaşabilirsin."
            } catch (_: IOException) {
                error = "Dosyaya erişilemedi. İndirilenler klasörünü kontrol et."
            } catch (_: SecurityException) {
                error = "Dosyaya erişim izni yok. İndirilenler klasörünü kontrol et."
            } finally {
                checking = false
            }
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledTonalButton(onClick = { launchFile(share = false) }, enabled = !checking,
                modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Aç")
            }
            OutlinedButton(onClick = { launchFile(share = true) }, enabled = !checking,
                modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Rounded.Share, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Paylaş")
            }
        }
        error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
    }
}

private fun actionAllowed(action: PhoneAction, deck: PhoneDeck?): Boolean =
    deck == null || if (action.kind in listOf("lock", "shutdown", "restart", "cancel")) deck.powerAllowed else deck.shortcutsAllowed

private fun actionKindLabel(kind: String): String = when (kind) {
    "application" -> "Uygulama aç"
    "file" -> "Dosya aç"
    "command" -> "PowerShell komutu"
    "lock" -> "Windows kilidi"
    "shutdown" -> "Bilgisayarı kapat"
    "restart" -> "Yeniden başlat"
    "cancel" -> "Güç planını iptal et"
    else -> "PC eylemi"
}

private fun actionDescription(action: PhoneAction): String = when (action.kind) {
    "shutdown", "restart" -> "${action.delaySeconds} saniye sonra uygulanır"
    "lock" -> "Windows oturumunu hemen kilitler"
    "cancel" -> "Planlanan kapatma veya yeniden başlatmayı iptal eder"
    else -> action.target
}

private fun actionIcon(kind: String): ImageVector = when (kind) {
    "file" -> Icons.Rounded.Folder
    "command" -> Icons.Rounded.Terminal
    "lock" -> Icons.Rounded.Lock
    "shutdown" -> Icons.Rounded.PowerSettingsNew
    "restart" -> Icons.Rounded.RestartAlt
    "cancel" -> Icons.Rounded.TimerOff
    else -> Icons.Rounded.Apps
}

private fun actionTint(kind: String): Color = when (kind) {
    "file" -> accentAmber
    "command" -> accentViolet
    "lock", "shutdown", "restart", "cancel" -> accentRed
    else -> accentBlue
}

private fun formatBytes(value: Long): String = when {
    value < 1024 -> "$value B"
    value < 1024 * 1024 -> "${value / 1024} KB"
    value < 1024L * 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MB", value / (1024.0 * 1024))
    else -> String.format(Locale.ROOT, "%.2f GB", value / (1024.0 * 1024 * 1024))
}

/** Mirrors the desktop's parseAction validation before saving. */
private fun validateDraft(draft: ActionDraft): JSONObject {
    val name = draft.name.trim()
    require(name.isNotBlank() && name.length <= 80) { "Kısayol adı 1–80 karakter olmalı." }
    val target = if (draft.kind in listOf("application", "file", "command")) draft.target.trim() else ""
    require(target.length <= 4096 && '\u0000' !in target) { "Komut veya yol geçersiz." }
    when (draft.kind) {
        "application" -> require(target.endsWith(".exe", true) &&
            (Regex("^[A-Za-z]:[\\\\/]").containsMatchIn(target) || Regex("^\\\\\\\\[^\\\\]+\\\\[^\\\\]+").containsMatchIn(target))) {
            "Uygulamanın Windows tam yolunu (.exe) gir."
        }
        "file" -> require(Regex("^[A-Za-z]:[\\\\/]").containsMatchIn(target)) {
            "Dosyanın tam Windows yolunu gir (ör. C:\\Belgeler\\dosya.pdf)."
        }
        "command" -> require(target.isNotBlank()) { "Bir PowerShell komutu gir." }
    }
    val args = if (draft.kind == "application") {
        val parsed = try { JSONArray(draft.argumentsText) }
        catch (_: Exception) { throw IllegalArgumentException("Argümanları JSON metin dizisi olarak gir.") }
        require(parsed.length() <= 32 && (0 until parsed.length()).all {
            parsed.opt(it) is String && parsed.getString(it).length <= 2048 && '\u0000' !in parsed.getString(it)
        }) { "En fazla 32 kısa metin argümanı gir." }
        parsed
    } else JSONArray()
    val seconds = if (draft.kind in listOf("shutdown", "restart")) {
        val value = draft.delayText.toLongOrNull() ?: throw IllegalArgumentException("Gecikme saniye olarak girilmeli.")
        require(value in 1..604800) { "Gecikme 1 ile 604800 saniye arasında olmalı." }
        value
    } else 0L
    return JSONObject().put("id", draft.id ?: UUID.randomUUID().toString())
        .put("name", name).put("kind", draft.kind).put("target", target)
        .put("arguments", args).put("delaySeconds", seconds)
}
