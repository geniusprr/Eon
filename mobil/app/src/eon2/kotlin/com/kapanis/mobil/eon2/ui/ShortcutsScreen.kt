package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.kapanis.mobil.eon2.network.EonPeerStatus
import com.kapanis.mobil.eon2.network.EonUsbClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

@Composable
internal fun ShortcutsScreen(
    client: EonUsbClient,
    peer: EonPeerStatus,
    pairingBusy: Boolean,
    pairingMessage: String?,
    bottomClearance: Dp,
    onPair: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val active = peer.connected && peer.paired
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val snackbar = remember { SnackbarHostState() }
    var deck by remember(active, peer.name, peer.transport) { mutableStateOf<DeckData?>(null) }
    var loadError by remember(active, peer.name, peer.transport) { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var loadRequest by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf<String?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    var confirmId by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf<ShortcutDraft?>(null) }
    var draftHost by remember { mutableStateOf<String?>(null) }
    var editError by remember { mutableStateOf<String?>(null) }

    suspend fun loadDeck() {
        val request = ++loadRequest
        try {
            val latest = withContext(Dispatchers.IO) { DeckData.parse(client.deck()) }
            if (request != loadRequest) return
            deck = latest
            loadError = null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (request == loadRequest) loadError = error.message ?: "Kısayollar alınamadı."
        }
    }

    LaunchedEffect(client, lifecycle, active, peer.name, peer.transport, refresh) {
        if (!active) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                if (busy == null) loadDeck()
                delay(5000)
            }
        }
    }
    LaunchedEffect(active, peer.name) {
        confirmId = null
        if (active && draftHost != peer.name) draft = null
    }

    val keys = deck?.keys.orEmpty()
    val canEdit = active && loadError == null && deck?.shortcutsAllowed == true
    val confirm = keys.firstOrNull { it.identity == confirmId }

    fun operation(id: String, success: String? = null, work: suspend () -> Unit) {
        if (!active || busy != null || loadError != null) return
        if (success != null) loadRequest++
        busy = id
        scope.launch {
            var feedback = success
            try {
                try {
                    work()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    val message = error.message ?: "İşlem tamamlanamadı."
                    if (id == "save") {
                        editError = message
                        feedback = null
                    } else {
                        feedback = message
                    }
                }
                if (success != null) loadDeck()
            } finally {
                busy = null
            }
            feedback?.let { snackbar.showSnackbar(it) }
        }
    }

    fun execute(key: DeckKey) {
        if (!key.approved || !key.available) return
        operation(key.identity, "${key.label} · Komut PC’ye gönderildi.") {
            withContext(Dispatchers.IO) {
                if (key.nativeTool) client.executeDeckCommand(key.id)
                else client.executeAction(key.id, key.kind)
            }
        }
    }

    Box(modifier, contentAlignment = Alignment.TopCenter) {
        ShortcutsContent(
            peer = peer, keys = keys, canEdit = canEdit, search = search, onSearch = { search = it },
            loading = active && deck == null && loadError == null, loadError = loadError,
            busy = busy, pairingBusy = pairingBusy, pairingMessage = pairingMessage,
            bottomClearance = bottomClearance, onPair = onPair, onRefresh = { refresh++ },
            onCreate = {
                editError = null
                draftHost = peer.name
                draft = ShortcutDraft()
            },
            onRun = { key ->
                if (key.confirm) confirmId = key.identity else execute(key)
            },
            onEdit = { key ->
                if (canEdit) operation(key.identity) {
                    draftHost = peer.name
                    draft = withContext(Dispatchers.IO) {
                        val actions = client.controls().getJSONArray("actions")
                        val saved = (0 until actions.length()).asSequence()
                            .map(actions::getJSONObject).firstOrNull { it.getString("id") == key.id }
                            ?: error("Bu kısayol PC’de silinmiş.")
                        ShortcutDraft.read(saved)
                    }
                    editError = null
                }
            },
            modifier = Modifier.widthIn(max = 900.dp).fillMaxSize(),
        )
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomClearance))
    }

    if (active && confirm != null) {
        AlertDialog(
            onDismissRequest = { confirmId = null },
            icon = { Icon(confirm.icon, null) },
            title = { Text(confirm.label) },
            text = { Text("Bu işlem bilgisayarında çalıştırılacak.") },
            confirmButton = {
                TextButton(enabled = busy == null && confirm.available && loadError == null, onClick = {
                    confirmId = null
                    execute(confirm)
                }) { Text(if (confirm.kind == "cancel") "Planı iptal et" else "Çalıştır") }
            },
            dismissButton = { TextButton(onClick = { confirmId = null }) { Text("Vazgeç") } },
        )
    }
    draft?.let { current ->
        ShortcutEditor(
            draft = current, saving = busy == "save", canEdit = canEdit && draftHost == peer.name, error = editError,
            onChange = { draft = it; editError = null },
            onDismiss = { if (busy != "save") draft = null },
            onSave = {
                try {
                    val payload = current.toPayload()
                    operation("save", "Kısayol kaydedildi.") {
                        withContext(Dispatchers.IO) { client.saveAction(payload) }
                        draft = null
                    }
                } catch (error: IllegalArgumentException) {
                    editError = error.message
                }
            },
        )
    }
}

@Composable
private fun ShortcutsContent(
    peer: EonPeerStatus,
    keys: List<DeckKey>,
    canEdit: Boolean,
    search: String,
    onSearch: (String) -> Unit,
    loading: Boolean,
    loadError: String?,
    busy: String?,
    pairingBusy: Boolean,
    pairingMessage: String?,
    bottomClearance: Dp,
    onPair: () -> Unit,
    onRefresh: () -> Unit,
    onCreate: () -> Unit,
    onRun: (DeckKey) -> Unit,
    onEdit: (DeckKey) -> Unit,
    modifier: Modifier = Modifier,
) {
    val active = peer.connected && peer.paired
    val focus = LocalFocusManager.current
    val (tools, saved) = remember(keys, search) {
        val query = search.trim().lowercase(Turkish)
        keys.distinctBy { it.identity }.filter { key ->
            query.isEmpty() || key.label.lowercase(Turkish).contains(query) ||
                key.label.contains(query, ignoreCase = true) || shortcutType(key).lowercase(Turkish).contains(query)
        }.partition { it.nativeTool }
    }
    val fontScale = LocalDensity.current.fontScale
    val colors = MaterialTheme.colorScheme
    LazyVerticalGrid(
        columns = if (fontScale >= 1.4f) GridCells.Fixed(1) else GridCells.Adaptive(148.dp),
        modifier = modifier,
        contentPadding = PaddingValues(start = 24.dp, top = 16.dp, end = 24.dp, bottom = bottomClearance + 20.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "header", span = { GridItemSpan(maxLineSpan) }) {
            Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Kısayollar", Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineLarge)
                        if (active) Text(
                            peer.name,
                            style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant,
                            maxLines = 2, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (active) IconButton(onClick = onRefresh, enabled = busy == null && !loading, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.Refresh, "Kısayolları yenile")
                    }
                }
                if (active && (canEdit || keys.isNotEmpty())) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = search, onValueChange = onSearch, singleLine = true,
                            modifier = Modifier.weight(1f),
                            label = { Text("Kısayol ara", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            leadingIcon = { Icon(Icons.Rounded.Search, null) },
                            trailingIcon = if (search.isEmpty()) null else {
                                { IconButton(onClick = { onSearch("") }) { Icon(Icons.Rounded.Close, "Aramayı temizle") } }
                            },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                            shape = MaterialTheme.shapes.medium,
                        )
                        if (canEdit) FilledIconButton(
                            onClick = { focus.clearFocus(); onCreate() },
                            enabled = busy == null,
                            modifier = Modifier.size(56.dp),
                            shape = MaterialTheme.shapes.medium,
                        ) { Icon(Icons.Rounded.Add, "Yeni kısayol oluştur") }
                    }
                }
            }
        }
        when {
            !active -> item(key = "connection", span = { GridItemSpan(maxLineSpan) }) {
                val canPair = peer.connected && !peer.paired && peer.transport == "usb"
                ShortcutNotice(
                    title = if (canPair) "Bilgisayarını eşleştir" else "Bilgisayar bağlantısı bekleniyor",
                    detail = if (canPair) peer.name else "USB veri kablosuyla bağlan veya eşleştirilmiş Tailscale bağlantını aç.",
                    icon = if (canPair) Icons.Rounded.Link else Icons.Rounded.WifiOff,
                ) {
                    pairingMessage?.let {
                        Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                            style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                    }
                    if (canPair) Button(onClick = onPair, enabled = !pairingBusy, shape = MaterialTheme.shapes.medium,
                        modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(if (pairingBusy) "PC onayı bekleniyor…" else "Eşleştir")
                    }
                }
            }
            loading -> item(key = "loading", span = { GridItemSpan(maxLineSpan) }) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    Text("Kısayollar yükleniyor…", Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
            }
            loadError != null -> item(key = "error", span = { GridItemSpan(maxLineSpan) }) {
                ShortcutNotice("Kısayollar yenilenemedi", loadError, Icons.Rounded.SyncProblem) {
                    TextButton(onClick = onRefresh, enabled = busy == null, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text("Tekrar dene")
                    }
                }
            }
        }
        if (active && !loading && loadError == null && !canEdit) {
            item(key = "permission", span = { GridItemSpan(maxLineSpan) }) {
                ShortcutNotice("Kısayollar izni kapalı", "PC’de Cihazlar → Kısayollar iznini aç.",
                    Icons.Rounded.Lock)
            }
        }
        if (active && !loading && loadError == null && saved.isEmpty() && (search.isBlank() || tools.isEmpty())) {
            item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                if (search.isNotBlank()) {
                    ShortcutNotice("Sonuç bulunamadı", "Başka bir ad veya işlem türü ara.", Icons.Rounded.SearchOff)
                } else if (canEdit) {
                    ShortcutNotice("Henüz kayıtlı kısayol yok", "Bir uygulama, dosya veya komut ekle.", Icons.Rounded.Bolt) {
                        TextButton(onClick = onCreate, enabled = busy == null, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Kısayol oluştur")
                        }
                    }
                }
            }
        }
        if (saved.isNotEmpty()) item(key = "saved", span = { GridItemSpan(maxLineSpan) }) {
            ShortcutSectionTitle("Kayıtlı kısayollar")
        }
        items(saved, key = { it.identity }) { key ->
            ShortcutCard(key, loadError == null && busy == null, busy == key.identity,
                onRun = { focus.clearFocus(); onRun(key) },
                onEdit = if (canEdit) ({ focus.clearFocus(); onEdit(key) }) else null)
        }
        if (tools.isNotEmpty()) item(key = "tools", span = { GridItemSpan(maxLineSpan) }) {
            ShortcutSectionTitle("Windows araçları")
        }
        items(tools, key = { it.identity }) { key ->
            ShortcutCard(key, loadError == null && busy == null, busy == key.identity,
                onRun = { focus.clearFocus(); onRun(key) })
        }
    }
}

@Composable
private fun ShortcutSectionTitle(title: String) {
    Text(title, Modifier.padding(top = 8.dp, bottom = 2.dp).semantics { heading() },
        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun ShortcutNotice(
    title: String,
    detail: String,
    icon: ImageVector,
    actions: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = MaterialTheme.colorScheme
    Surface(shape = eonPanelShape, color = colors.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, null, tint = colors.primary, modifier = Modifier.size(24.dp))
            Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
            actions()
        }
    }
}

@Composable
private fun ShortcutCard(
    key: DeckKey,
    enabled: Boolean,
    busy: Boolean,
    onRun: () -> Unit,
    onEdit: (() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val countdown = powerCountdown(key.deadline)
    val available = key.available && key.approved
    val label = when {
        !key.approved -> "Yalnızca PC"
        !available -> if (key.power) "Güç izni gerekli" else "Kısayollar izni gerekli"
        countdown != null -> "Durdur · $countdown"
        isTimedPowerAction(key.kind, key.delaySeconds) -> when {
            key.delaySeconds % 60L == 0L -> "${key.delaySeconds / 60} dk gecikme"
            else -> "${key.delaySeconds} sn gecikme"
        }
        else -> shortcutType(key).takeUnless { it.equals(key.label, ignoreCase = true) } ?: "Çalıştır"
    }
    val accent = if (available) key.tint else colors.onSurfaceVariant
    Surface(
        modifier = Modifier.fillMaxWidth().clip(eonPanelShape).clickable(
            enabled = enabled && available, role = Role.Button,
            onClickLabel = if (countdown == null) "Çalıştır" else "Planı durdur",
            onClick = onRun,
        ).semantics {
            if (!available || countdown != null) stateDescription = label
        },
        shape = eonPanelShape,
        color = if (countdown == null) colors.surface else colors.tertiaryContainer,
        border = BorderStroke(1.dp, if (countdown == null) colors.outlineVariant else colors.primary),
    ) {
        Column(Modifier.padding(start = 12.dp, top = 8.dp, end = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).background(accent.copy(alpha = .13f), MaterialTheme.shapes.medium),
                    contentAlignment = Alignment.Center) {
                    Icon(key.icon, null, Modifier.size(22.dp), tint = accent)
                }
                Spacer(Modifier.weight(1f))
                when {
                    busy -> CircularProgressIndicator(Modifier.padding(12.dp).size(20.dp), strokeWidth = 2.dp)
                    onEdit != null -> IconButton(onClick = onEdit, enabled = enabled, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.Edit, "${key.label} kısayolunu düzenle", Modifier.size(18.dp),
                            tint = if (enabled) colors.onSurfaceVariant else colors.onSurfaceVariant.copy(alpha = .38f))
                    }
                }
            }
            Column(Modifier.padding(end = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(key.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                    minLines = if (LocalDensity.current.fontScale >= 1.4f) 1 else 2,
                    maxLines = 3, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon(
                        when {
                            countdown != null -> Icons.Rounded.Stop
                            !available -> Icons.Rounded.Lock
                            else -> Icons.Rounded.PlayArrow
                        },
                        null, Modifier.size(14.dp), tint = if (available) colors.primary else colors.onSurfaceVariant,
                    )
                    Text(label, style = MaterialTheme.typography.bodySmall,
                        color = if (countdown == null) colors.onSurfaceVariant else colors.onTertiaryContainer)
                }
            }
        }
    }
}

private val Turkish = Locale.forLanguageTag("tr-TR")

private fun shortcutType(key: DeckKey): String = if (key.nativeTool) "Windows aracı" else shortcutKindLabel(key.kind)

@Preview(name = "Kısayollar · Obsidian", widthDp = 393, heightDp = 740)
@Preview(name = "Kısayollar · Aydınlık", widthDp = 360, heightDp = 740, fontScale = 1.5f)
@Composable
private fun ShortcutsPreview() {
    val theme = if (LocalDensity.current.fontScale > 1f) "light" else "obsidian"
    EonTheme(theme) {
        EonGlassBackdrop {
            ShortcutsContent(
                peer = EonPeerStatus(true, "Eon Desktop", true, transport = "usb"),
                keys = listOf(
                    DeckKey("browser", "Tarayıcıyı aç", "application", true, customIcon = "globe"),
                    DeckKey("lock", "Windows’u kilitle", "lock", true),
                    DeckKey("power", "Yeniden başlat", "restart", false),
                    DeckKey("explorer", "Dosyalar", "folder", true),
                ),
                canEdit = true, search = "", onSearch = {}, loading = false, loadError = null,
                busy = null, pairingBusy = false, pairingMessage = null, bottomClearance = 0.dp,
                onPair = {}, onRefresh = {}, onCreate = {}, onRun = {}, onEdit = {},
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
