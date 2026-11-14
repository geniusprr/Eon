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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
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
import androidx.compose.ui.unit.Dp
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
import org.json.JSONObject
import java.io.IOException
import java.util.Locale

private val accentMint = Color(0xFF7BD2A4)
private val accentBlue = Color(0xFF8BBFF9)

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

private data class PendingUpload(val uri: Uri, val name: String, val size: Long)
@Composable
internal fun LocalSendScreen(
    client: EonUsbClient,
    receivedFiles: List<ReceivedDownload>,
    bottomClearance: Dp,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var files by remember { mutableStateOf<List<PhoneFile>>(emptyList()) }
    var reloadRequest by remember { mutableIntStateOf(0) }
    var loaded by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("all") }

    suspend fun reload() {
        val request = ++reloadRequest
        val result = withContext(Dispatchers.IO) { client.files() }
        if (request != reloadRequest) return
        val array = result.getJSONArray("files")
        files = (0 until array.length()).map { PhoneFile.read(array.getJSONObject(it)) }
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

    LaunchedEffect(client, lifecycle) {
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
                    Text("Local Send", modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    IconButton(enabled = !busy, onClick = {
                        refreshNow()
                    }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.Refresh, "Listeyi yenile")
                    }
                }
                Text("Telefon ile bilgisayar arasında doğrudan dosya aktar.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                Button(enabled = !busy, onClick = { openDocument.launch(arrayOf("*/*")) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = MaterialTheme.shapes.medium) {
                    Icon(Icons.Rounded.UploadFile, null, Modifier.size(19.dp))
                    Spacer(Modifier.width(9.dp)); Text("Dosya gönder")
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
            val error = if (loadError != null && receivedFiles.isNotEmpty()) {
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
        if (loaded || receivedFiles.isNotEmpty()) item(key = "filters") {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Aktarım listesi",
                        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("${transferHistory.size} dosya",
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(value = search, onValueChange = { search = it },
                    modifier = Modifier.fillMaxWidth(), singleLine = true,
                    placeholder = { Text("Dosya ara") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    trailingIcon = { if (search.isNotBlank()) IconButton(onClick = { search = "" }) {
                        Icon(Icons.Rounded.Close, "Aramayı temizle") } },
                    shape = MaterialTheme.shapes.medium)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("all" to "Tümü", "incoming" to "PC’den gelen", "outgoing" to "PC’ye giden")
                        .forEach { (value, label) -> FilterChip(selected = filter == value, onClick = { filter = value },
                            label = { Text(label) }) }
                }
            }
        }
        if ((loaded || receivedFiles.isNotEmpty()) && filteredFiles.isEmpty()) item(key = "files-empty") {
            EmptyControlState(Icons.Rounded.FolderOpen,
                if (transferHistory.isEmpty()) "Aktarım kuyruğu boş" else "Eşleşen dosya bulunamadı",
                if (transferHistory.isEmpty()) "PC’den bu telefona dosya gönderilebilir veya yukarıdan bir dosya seçebilirsin."
                else "Arama metnini veya filtreyi değiştir.")
        }
        items(filteredFiles, key = { "file-${it.id}" }) { file ->
            FileControlCard(file)
        }
        item(key = "permission-hint") {
            Text("Aktarım için PC → Cihazlar → Dosyalar izni açık olmalı. Gelen dosyalar Downloads’a, gönderilenler PC’deki Eon klasörüne otomatik kaydedilir.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
    }

}

@Composable
private fun ControlIcon(image: ImageVector, tint: Color) {
    val foreground = if (MaterialTheme.colorScheme.surface.luminance() > .5f) MaterialTheme.colorScheme.primary else tint
    Box(Modifier.size(42.dp).background(foreground.copy(alpha = .13f), MaterialTheme.shapes.small),
        contentAlignment = Alignment.Center) {
        Icon(image, null, Modifier.size(22.dp), tint = foreground)
    }
}

@Composable
private fun ControlNotice(notice: String?, error: String?, onRetry: () -> Unit) {
    val problem = error != null
    Surface(shape = MaterialTheme.shapes.medium,
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
    Surface(shape = eonPanelShape, color = MaterialTheme.colorScheme.surfaceContainerLow) {
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
private fun FileControlCard(file: PhoneFile) {
    val incoming = file.direction == "send"
    Surface(modifier = Modifier.eonGlass(eonPanelShape), shape = eonPanelShape, color = Color.Transparent,
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
            FilledTonalButton(shape = MaterialTheme.shapes.medium, onClick = { launchFile(share = false) }, enabled = !checking,
                modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Aç")
            }
            OutlinedButton(shape = MaterialTheme.shapes.medium, onClick = { launchFile(share = true) }, enabled = !checking,
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

private fun formatBytes(value: Long): String = when {
    value < 1024 -> "$value B"
    value < 1024 * 1024 -> "${value / 1024} KB"
    value < 1024L * 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MB", value / (1024.0 * 1024))
    else -> String.format(Locale.ROOT, "%.2f GB", value / (1024.0 * 1024 * 1024))
}
