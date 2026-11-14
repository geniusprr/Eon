package com.kapanis.mobil.eon2.ui

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.kapanis.mobil.eon2.network.EonPeerStatus
import com.kapanis.mobil.eon2.network.EonDeckConflictException
import com.kapanis.mobil.eon2.network.EonUsbClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@get:Composable private val darkDeck get() = MaterialTheme.colorScheme.background.luminance() < .5f
@get:Composable private val surface get() = MaterialTheme.colorScheme.surface
@get:Composable private val surfaceHigh get() = MaterialTheme.colorScheme.surfaceVariant
@get:Composable private val border get() = MaterialTheme.colorScheme.outline
@get:Composable private val ink get() = MaterialTheme.colorScheme.onSurface
@get:Composable private val muted get() = MaterialTheme.colorScheme.onSurfaceVariant
@get:Composable private val teal get() = MaterialTheme.colorScheme.primary
@get:Composable private val violet get() = if (darkDeck) Color(0xFFCEB5FF) else Color(0xFF7053AC)
@get:Composable private val blue get() = if (darkDeck) Color(0xFF95C7F8) else Color(0xFF356B9C)
@get:Composable private val amber get() = if (darkDeck) Color(0xFFF7C891) else Color(0xFF91612A)
@get:Composable private val coral get() = if (darkDeck) Color(0xFFFFA5AB) else Color(0xFFA6384F)
private val deckSpacing = 8.dp
private const val QUICK_SLOT_LIMIT = 6

// EonPeerStatus currently exposes the desktop host name, not a persistent machine UUID.
// Hashing its normalised name provides a stable local preference namespace across USB/Tailscale.
private fun quickPreferenceKey(host: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest(host.trim().lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8))
    return "quickIdsV1_" + digest.joinToString("") { "%02x".format(Locale.ROOT, it.toInt() and 0xff) }
}

// Null means no saved customisation: show the first six authorised commands by default.
// An explicit empty JSON array means the user intentionally removed every quick command.
private fun readQuickIds(json: String?): List<String>? {
    if (json == null) return null
    return runCatching {
        val values = JSONArray(json)
        buildList {
            for (index in 0 until minOf(values.length(), QUICK_SLOT_LIMIT)) {
                val id = values.optString(index).takeIf { it.isNotBlank() } ?: continue
                if (id !in this) add(id)
            }
        }
    }.getOrNull()
}

private fun encodeQuickIds(ids: List<String>): String = JSONArray(ids.take(QUICK_SLOT_LIMIT)).toString()

private fun cachedLayout(context: android.content.SharedPreferences, key: String?): DeckLayout {
    return runCatching { DeckLayout.parse(JSONObject(context.getString(key, null) ?: "")) }
        .getOrElse { DeckLayout.defaults() }
}

private fun layoutStorageKey(host: String) = "canvasV1_" + quickPreferenceKey(host)

internal data class DeckKey(val id: String, val label: String, val kind: String, val available: Boolean,
    val approved: Boolean = true, val customIcon: String = "", val delaySeconds: Long = 0, val deadline: Long? = null) {
    val nativeTool get() = kind in listOf("folder", "terminal", "chart", "settings")
    val identity get() = "${if (nativeTool) "tool" else "action"}:$id"
    val power get() = kind in listOf("lock", "shutdown", "restart", "cancel")
    val confirm get() = !isTimedPowerAction(kind, delaySeconds) &&
        !isPowerCountdownActive(deadline) && (power || kind == "command")
    val icon: ImageVector get() = when (customIcon.ifBlank { kind }) {
        "app" -> Icons.Rounded.Apps
        "code" -> Icons.Rounded.Code
        "globe" -> Icons.Rounded.Language
        "gamepad" -> Icons.Rounded.SportsEsports
        "music" -> Icons.Rounded.MusicNote
        "video" -> Icons.Rounded.Videocam
        "camera" -> Icons.Rounded.PhotoCamera
        "image" -> Icons.Rounded.Image
        "star" -> Icons.Rounded.Star
        "heart" -> Icons.Rounded.FavoriteBorder
        "zap" -> Icons.Rounded.Bolt
        "coffee" -> Icons.Rounded.Coffee
        "headphones" -> Icons.Rounded.Headphones
        "mail" -> Icons.Rounded.Email
        "calendar" -> Icons.Rounded.CalendarMonth
        "book" -> Icons.Rounded.MenuBook
        "folder", "file" -> Icons.Rounded.Folder
        "application" -> Icons.Rounded.Launch
        "terminal", "command" -> Icons.Rounded.Terminal
        "chart" -> Icons.Rounded.BarChart
        "settings" -> Icons.Rounded.Settings
        "lock" -> Icons.Rounded.Lock
        "restart" -> Icons.Rounded.RestartAlt
        "shutdown" -> Icons.Rounded.PowerSettingsNew
        "cancel" -> Icons.Rounded.TimerOff
        else -> Icons.Rounded.Apps
    }
    @get:Composable val tint get() = when (kind) {
        "folder", "file" -> amber
        "terminal", "command" -> violet
        "chart" -> teal
        "settings" -> muted
        "lock", "shutdown", "restart", "cancel" -> coral
        else -> blue
    }
}

internal data class DeckData(val keys: List<DeckKey>, val shortcutsAllowed: Boolean, val mediaAvailable: Boolean,
    val gpu: JSONObject?, val media: JSONObject?, val mediaChecked: Boolean) {
    companion object {
        fun parse(value: JSONObject): DeckData {
            val allowed = value.optBoolean("shortcutsAllowed")
            val tools = value.optJSONArray("tools") ?: org.json.JSONArray()
            val actions = value.optJSONArray("actions") ?: org.json.JSONArray()
            val sampledAt = value.optLong("sampledAt", System.currentTimeMillis())
            val keys = buildList {
                for (index in 0 until tools.length()) {
                    val item = tools.optJSONObject(index) ?: continue
                    val id = item.optString("id")
                    if (id !in setOf("explorer", "terminal", "tasks", "settings")) continue
                    add(DeckKey(id, item.optString("name").ifBlank { id }, item.optString("icon", "application"), allowed))
                }
                for (index in 0 until actions.length()) {
                    val item = actions.optJSONObject(index) ?: continue
                    val id = item.optString("id")
                    val kind = item.optString("kind")
                    if (id.isBlank() || kind !in setOf("application", "file", "command", "lock", "shutdown", "restart", "cancel")) continue
                    add(DeckKey(id, item.optString("name").ifBlank { kind }, kind, item.optBoolean("available"),
                        item.optBoolean("remoteEnabled"), item.optString("icon"), item.optLong("delaySeconds"),
                        powerDeadline(item.optLong("activeUntil"), sampledAt)))
                }
            }
            return DeckData(keys, allowed, value.optBoolean("mediaAvailable"), value.optJSONObject("gpu"), value.optJSONObject("media"), value.has("media"))
        }
    }
}

@Composable
fun LandscapeDeck(client: EonUsbClient, peer: EonPeerStatus, foreground: Boolean, onConnect: () -> Unit, onPortrait: () -> Unit) {
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val appContext = LocalContext.current.applicationContext
    val preferences = remember(appContext) { appContext.getSharedPreferences("eon2-deck-layout", Context.MODE_PRIVATE) }
    var denseGrid by remember(preferences) { mutableStateOf(preferences.getBoolean("denseGrid", false)) }
    val peerPreferenceKey = remember(peer.connected, peer.paired, peer.name) {
        if (peer.connected && peer.paired && peer.name.isNotBlank()) quickPreferenceKey(peer.name) else null
    }
    val layoutHost = remember(peer.connected, peer.paired, peer.name, preferences) {
        if (peer.connected && peer.paired && peer.name.isNotBlank()) peer.name
        else preferences.getString("lastDeckHost", null).orEmpty()
    }
    val layoutPreferenceKey = remember(layoutHost) { layoutHost.takeIf { it.isNotBlank() }?.let(::layoutStorageKey) }
    var layout by remember(preferences, layoutPreferenceKey) {
        mutableStateOf(cachedLayout(preferences, layoutPreferenceKey))
    }
    var remoteLayout by remember(layoutPreferenceKey) { mutableStateOf<DeckLayout?>(null) }
    var layoutError by remember(layoutPreferenceKey) { mutableStateOf<String?>(null) }
    var editingLayout by remember(layoutPreferenceKey) { mutableStateOf(false) }
    var draftLayout by remember(layoutPreferenceKey) { mutableStateOf(DeckLayout.defaults().widgets) }
    var draftBaseRevision by remember(layoutPreferenceKey) { mutableIntStateOf(0) }
    var editingLayoutPageId by remember(layoutPreferenceKey) { mutableStateOf<String?>(null) }
    var selectedWidget by remember(layoutPreferenceKey) { mutableStateOf("clock") }
    var savingLayout by remember(layoutPreferenceKey) { mutableStateOf(false) }
    var layoutConflict by remember(layoutPreferenceKey) { mutableStateOf<DeckLayout?>(null) }
    var layoutRefresh by remember { mutableIntStateOf(0) }
    var storedQuickIds by remember(preferences, peerPreferenceKey) {
        mutableStateOf(peerPreferenceKey?.let { readQuickIds(preferences.getString(it, null)) })
    }
    var draftHideShortcutNames by remember(layoutPreferenceKey) { mutableStateOf(false) }
    var editingQuick by remember(peerPreferenceKey) { mutableStateOf(false) }
    var editingShortcuts by remember(layoutPreferenceKey) { mutableStateOf(false) }
    var shortcutSelectionChanged by remember(layoutPreferenceKey) { mutableStateOf(false) }
    var shortcutEditBase by remember(layoutPreferenceKey) { mutableStateOf<DeckLayout?>(null) }
    var editingQuickPageId by remember(layoutPreferenceKey) { mutableStateOf<String?>(null) }
    var draftQuickIds by remember(peerPreferenceKey) { mutableStateOf<List<String>>(emptyList()) }
    var savingQuick by remember(peerPreferenceKey) { mutableStateOf(false) }
    var quickConflict by remember(peerPreferenceKey) { mutableStateOf<DeckLayout?>(null) }
    var data by remember(peer.paired, peer.connected, peer.name) { mutableStateOf<DeckData?>(null) }
    var loadError by remember(peer.paired, peer.connected, peer.name) { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<DeckKey?>(null) }
    var refresh by remember { mutableIntStateOf(0) }

    LaunchedEffect(client, lifecycle, peer.connected, peer.paired, peer.name, refresh) {
        if (!peer.connected || !peer.paired) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            var lastDeckSnapshot: String? = null
            while (true) {
                try {
                    // Status updates are frequent; unchanged responses should not redraw every tile.
                    val updated = withContext(Dispatchers.IO) {
                        val response = client.deck()
                        val snapshot = response.toString()
                        if (snapshot == lastDeckSnapshot) null
                        else {
                            val parsed = DeckData.parse(response)
                            lastDeckSnapshot = snapshot
                            parsed
                        }
                    }
                    if (updated != null) data = updated
                    loadError = null
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    data = null
                    lastDeckSnapshot = null
                    loadError = error.message ?: "Kısayollar yüklenemedi."
                }
                delay(3000)
            }
        }
    }
    LaunchedEffect(client, lifecycle, peer.connected, peer.paired, layoutPreferenceKey, layoutRefresh) {
        if (!peer.connected || !peer.paired || layoutPreferenceKey == null) return@LaunchedEffect
        preferences.edit().putString("lastDeckHost", peer.name).apply()
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                try {
                    var latest = withContext(Dispatchers.IO) { DeckLayout.parse(client.deckLayout()) }
                    if (!isNewerDeckRevision(latest, layout, remoteLayout)) {
                        // An older in-flight response must not regress the revision saved by this phone.
                        delay(4000)
                        continue
                    }
                    val quickKey = peerPreferenceKey
                    if (quickKey != null && !latest.quickIdsSpecified &&
                        !preferences.getBoolean("syncedQuickV1_$quickKey", false) &&
                        !preferences.getBoolean("pendingQuickV1_$quickKey", false) &&
                        !editingQuick && !editingLayout && !savingLayout && !savingQuick &&
                        data?.shortcutsAllowed == true && storedQuickIds != null) {
                        // Old Android builds kept their six favourites only on the phone.
                        // Publish them once when the PC has no saved shortcut selection yet.
                        val known = data?.keys.orEmpty().map { it.identity }.toSet()
                        val previous = storedQuickIds.orEmpty().filter { it in known }.take(QUICK_SLOT_LIMIT)
                        savingQuick = true
                        try {
                            latest = withContext(Dispatchers.IO) {
                                DeckLayout.parse(client.saveDeckLayout(latest.revision, widgetsToJson(latest.widgets),
                                    previous, updateQuickIds = true,
                                    pages = if (latest.pagesSpecified || latest.pages.isNotEmpty()) pagesToJson(latest.pages) else null))
                            }
                            preferences.edit().putBoolean("syncedQuickV1_$quickKey", true).apply()
                            storedQuickIds = previous
                            result = "Eski hızlı tuşların PC paneline eşitlendi."
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { /* Keep local favourites and retry next poll. */ }
                        finally { savingQuick = false }
                    }
                    if (remoteLayout != latest) remoteLayout = latest
                    layoutError = null
                    if (editingLayout) {
                        if (latest.revision != draftBaseRevision) layoutConflict = latest
                    } else if (!savingLayout && !savingQuick) {
                        if (layout != latest) {
                            layout = latest
                            preferences.edit().putString(layoutPreferenceKey, latest.toJson()).apply()
                        }
                    }
                    if (quickKey != null && latest.quickIdsSpecified && !editingQuick && !savingQuick && !editingLayout &&
                        !preferences.getBoolean("pendingQuickV1_$quickKey", false)) {
                        val migrationKey = "syncedQuickV1_$quickKey"
                        if (storedQuickIds != latest.quickIds || !preferences.getBoolean(migrationKey, false)) {
                            storedQuickIds = latest.quickIds
                            preferences.edit().apply {
                                if (latest.quickIds == null) remove(quickKey)
                                else putString(quickKey, encodeQuickIds(latest.quickIds))
                                putBoolean(migrationKey, true)
                            }.apply()
                        }
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) { layoutError = error.message ?: "PC paneli okunamadı." }
                delay(4000)
            }
        }
    }
    LaunchedEffect(result) {
        if (result != null) { delay(5000); result = null }
    }

    fun execute(label: String, work: () -> JSONObject) {
        if (running) return
        running = true
        result = null
        scope.launch {
            try {
                val response = withContext(Dispatchers.IO) { work() }
                check(!response.has("ok") || response.optBoolean("ok")) { "$label işlemi PC tarafından kabul edilmedi." }
                result = "$label · Komut iletildi"
                refresh++
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                result = error.message ?: "İşlem çalıştırılamadı."
                refresh++
            } finally { running = false }
        }
    }
    fun runKey(key: DeckKey) = execute(key.label) {
        if (key.nativeTool) client.executeDeckCommand(key.id) else client.executeAction(key.id, key.kind)
    }
    val selectKey: (DeckKey) -> Unit = { key ->
        when {
            !peer.connected || !peer.paired -> result = "Önce bilgisayara bağlan."
            loadError != null -> result = "Bağlantı doğrulanamadı. Tekrar dene."
            !key.approved -> result = "PC’de Kısayollar’dan “${key.label}” için telefon erişimini aç."
            !key.available -> result = if (key.power) "PC’de Cihazlar bölümünden Güç iznini aç." else "PC’de Cihazlar bölümünden Kısayollar iznini aç."
            key.confirm -> confirm = key
            else -> runKey(key)
        }
    }

    val paired = peer.connected && peer.paired
    val keys = data?.keys.orEmpty()
    val availableKeys = remember(keys) { keys.filter { it.available && it.approved }.distinctBy { it.identity } }
    val knownIds = remember(keys) { keys.map { it.identity }.toSet() }
    // Keep IDs on temporary permission loss; only remove commands actually deleted on the PC.
    LaunchedEffect(peerPreferenceKey, knownIds, data != null, storedQuickIds) {
        val key = peerPreferenceKey ?: return@LaunchedEffect
        if (data == null) return@LaunchedEffect
        val stored = storedQuickIds ?: return@LaunchedEffect
        val valid = stored.distinct().filter { it in knownIds }.take(QUICK_SLOT_LIMIT)
        if (valid != stored) {
            storedQuickIds = valid
            preferences.edit().putString(key, encodeQuickIds(valid)).apply()
        }
    }
    val quickKeys = remember(availableKeys, storedQuickIds) {
        val customIds = storedQuickIds
        if (customIds == null) availableKeys.take(QUICK_SLOT_LIMIT)
        else customIds.mapNotNull { id -> availableKeys.firstOrNull { it.identity == id } }
    }
    val distinctKeys = remember(keys) { keys.distinctBy { it.identity } }
    val shortcutKeys = remember(distinctKeys, layout.shortcutIds) {
        val byId = distinctKeys.associateBy { it.identity }
        layout.shortcutIds?.mapNotNull(byId::get) ?: distinctKeys
    }
    val shortcutScroll = rememberLazyGridState()
    val pager = rememberPagerState { 2 + layout.pages.size }
    val shortcutsSelected = pager.settledPage == layout.pages.size + 1
    var choosingPage by remember { mutableStateOf(false) }
    val pageTitle: (Int) -> String = { index ->
        if (index == 0) "Deck" else layout.pages.getOrNull(index - 1)?.name ?: "Kısayollar"
    }
    val beginQuickEdit: () -> Unit = {
        val page = layout.pages.getOrNull(pager.settledPage - 1)
        editingShortcuts = shortcutsSelected
        shortcutEditBase = remoteLayout
        shortcutSelectionChanged = false
        editingQuickPageId = page?.id
        draftQuickIds = if (shortcutsSelected) layout.shortcutIds ?: distinctKeys.map { it.identity }
        else ((page?.quickIds ?: if (page != null) null else storedQuickIds)
            ?: availableKeys.take(QUICK_SLOT_LIMIT).map { it.identity }).filter { it in knownIds }
        draftHideShortcutNames = layout.hideShortcutNames
        editingQuick = true
    }
    val stateText = when {
        !peer.connected -> "Çevrimdışı"
        !peer.paired -> "Eşleştirme gerekli"
        else -> peer.name
    }
    val layoutEditable = paired && data?.shortcutsAllowed == true && remoteLayout != null && layoutError == null
    fun saveQuickSelection(ids: List<String>?) {
        if (savingQuick) return
        val isShortcuts = editingShortcuts
        val pageId = editingQuickPageId
        val key = peerPreferenceKey ?: return
        val value = if (isShortcuts) ids?.distinct() else ids?.distinct()?.filter { it in knownIds }?.take(QUICK_SLOT_LIMIT)
        val isMainQuick = !isShortcuts && pageId == null
        if (isMainQuick) {
            storedQuickIds = value
            preferences.edit().apply {
                if (value == null) remove(key) else putString(key, encodeQuickIds(value))
                putBoolean("pendingQuickV1_$key", true)
            }.apply()
        }
        if (!layoutEditable) {
            if (isMainQuick) editingQuick = false
            result = if (isMainQuick) "Hızlı tuşlar telefona kaydedildi. PC eşitlemesi için izin ve bağlantı gerekli."
                else "Bu sayfanın değişiklikleri PC bağlantısı ve izin olmadığından kaydedilemedi."
            return
        }
        val original = (if (isShortcuts) shortcutEditBase else remoteLayout) ?: return
        if (pageId != null && original.pages.none { it.id == pageId }) {
            result = "Bu sayfa PC'den kaldırılmış. Güncel düzeni yükle."
            return
        }
        val changedPages = if (pageId != null) original.pages.map { page ->
            if (page.id == pageId) page.copy(quickIds = value) else page
        } else original.pages
        savingQuick = true
        scope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    DeckLayout.parse(client.saveDeckLayout(original.revision, widgetsToJson(original.widgets), value,
                        updateQuickIds = isMainQuick,
                        pages = if (pageId != null || original.pagesSpecified || original.pages.isNotEmpty())
                            pagesToJson(changedPages) else null, hideShortcutNames = draftHideShortcutNames,
                        shortcutIds = value, updateShortcutIds = isShortcuts))
                }
                layout = response
                remoteLayout = response
                layoutPreferenceKey?.let { preferences.edit().putString(it, response.toJson()).apply() }
                editingQuick = false
                if (isMainQuick) preferences.edit().putBoolean("syncedQuickV1_$key", true)
                    .putBoolean("pendingQuickV1_$key", false).apply()
                layoutError = null
                result = if (isShortcuts) "Kısayollar ekranı kaydedildi." else "Hızlı tuşlar PC’ye kaydedildi."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (conflict: EonDeckConflictException) {
                quickConflict = conflict.serverLayout?.let { runCatching { DeckLayout.parse(it) }.getOrNull() }
                    ?: runCatching { withContext(Dispatchers.IO) { DeckLayout.parse(client.deckLayout()) } }.getOrNull()
                result = "PC'deki hızlı tuşlar değişmiş. Güncel düzeni yükleyebilirsin."
            } catch (error: Exception) {
                result = if (isMainQuick)
                    "Telefona kaydedildi; PC’ye aktarılamadı: ${error.message ?: "Bağlantı hatası"}."
                    else "Bu sayfanın kısayolları kaydedilemedi: ${error.message ?: "Bağlantı hatası"}. Tekrar dene."
            } finally { savingQuick = false }
        }
    }
    val beginLayoutEdit: () -> Unit = {
        if (layoutEditable) {
            val page = layout.pages.getOrNull(pager.settledPage - 1)
            editingLayoutPageId = page?.id
            draftLayout = page?.widgets ?: layout.widgets
            draftBaseRevision = layout.revision
            selectedWidget = "clock"
            layoutConflict = null
            editingLayout = true
        } else {
            result = if (!paired) "Önce PC bağlantısını aç." else if (data?.shortcutsAllowed != true)
                "PC'de Cihazlar bölümünden Eylemleri çalıştır iznini aç." else "Panel düzeni PC'den yüklenemedi. Tekrar dene."
        }
    }
    val discardLayout: () -> Unit = {
        editingLayout = false
        layoutConflict = null
        remoteLayout?.let { latest ->
            layout = latest
            layoutPreferenceKey?.let { preferences.edit().putString(it, latest.toJson()).apply() }
        }
    }
    val saveLayout: () -> Unit = save@{
        if (savingLayout || !layoutEditable || layoutConflict != null) return@save
        if (!validDeckWidgets(draftLayout)) { result = "Panel bileşenleri çakışıyor."; return@save }
        savingLayout = true
        val pageId = editingLayoutPageId
        val original = remoteLayout ?: layout
        if (pageId != null && original.pages.none { it.id == pageId }) {
            savingLayout = false
            result = "Bu sayfa PC'den kaldırılmış. Güncel paneli yükle."
            return@save
        }
        val changedPages = if (pageId != null) original.pages.map { page ->
            if (page.id == pageId) page.copy(widgets = draftLayout) else page
        } else original.pages
        scope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    DeckLayout.parse(client.saveDeckLayout(draftBaseRevision,
                        widgetsToJson(if (pageId == null) draftLayout else original.widgets),
                        pages = if (pageId != null || original.pagesSpecified || original.pages.isNotEmpty())
                            pagesToJson(changedPages) else null))
                }
                layout = response
                remoteLayout = response
                layoutPreferenceKey?.let { preferences.edit().putString(it, response.toJson()).apply() }
                editingLayout = false
                layoutError = null
                result = "Panel bilgisayara kaydedildi."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (conflict: EonDeckConflictException) {
                layoutConflict = conflict.serverLayout?.let { runCatching { DeckLayout.parse(it) }.getOrNull() }
                    ?: runCatching { withContext(Dispatchers.IO) { DeckLayout.parse(client.deckLayout()) } }.getOrNull()
                result = "PC paneli değişmiş. Yeniden yükleyerek düzenleyebilirsin."
            } catch (error: Exception) {
                result = "Kaydedilemedi: ${error.message ?: "Bağlantı hatası"}. Yeniden deneyebilirsin."
            } finally { savingLayout = false }
        }
    }
    BackHandler(enabled = editingQuick || editingLayout) {
        if (savingQuick || savingLayout) return@BackHandler
        if (editingLayout) discardLayout() else editingQuick = false
    }
    DeckGlassBackdrop {
        Column(Modifier.fillMaxSize().displayCutoutPadding().padding(12.dp), verticalArrangement = Arrangement.spacedBy(deckSpacing)) {
            if (editingLayout) {
                DeckLayoutEditor(
                    widgets = draftLayout, selectedId = selectedWidget,
                    onSelect = { selectedWidget = it },
                    onChange = { changed ->
                        val next = changeDeckWidget(draftLayout, changed)
                        if (next == null) result = "Bu konum dolu veya 12×6 sınırının dışında."
                        else { draftLayout = next; result = null }
                    },
                    onSave = saveLayout, onCancel = discardLayout,
                    onReset = { draftLayout = DeckLayout.defaults().widgets; selectedWidget = "clock" },
                    canSave = layoutEditable && !savingLayout && layoutConflict == null,
                    saving = savingLayout, offline = !paired, error = layoutError,
                    peer = peer, foreground = foreground, keys = editingLayoutPageId?.let { id ->
                        layout.pages.find { it.id == id }?.quickIds?.let { ids ->
                            ids.mapNotNull { keyId -> availableKeys.find { it.identity == keyId } }
                        } ?: availableKeys.take(QUICK_SLOT_LIMIT)
                    } ?: quickKeys, running = running,
                    data = data, onKey = selectKey, onMedia = { id, label ->
                        if (data?.shortcutsAllowed == true) execute(label) { client.executeDeckCommand(id) }
                    }, modifier = Modifier.weight(1f).fillMaxWidth())
            } else if (editingQuick) {
                DeckQuickEditor(
                    hideShortcutNames = draftHideShortcutNames,
                    onHideNamesChange = { draftHideShortcutNames = it },
                    namesEditable = layoutEditable && !savingQuick,
                    shortcutScreen = editingShortcuts,
                    saving = savingQuick,
                    canSave = !savingQuick && (!editingShortcuts || layoutEditable) && quickConflict == null,
                    knownKeys = distinctKeys,
                    authorised = if (editingShortcuts) distinctKeys else availableKeys,
                    selectedIds = draftQuickIds,
                    onChange = { draftQuickIds = it; shortcutSelectionChanged = true },
                    onSave = {
                        // Existing favourites remain when an action temporarily loses permission.
                        saveQuickSelection(if (editingShortcuts && !shortcutSelectionChanged) shortcutEditBase?.shortcutIds else draftQuickIds)
                    },
                    onReset = { saveQuickSelection(null) },
                    onCancel = { editingQuick = false },
                    modifier = Modifier.weight(1f).fillMaxWidth()
                )
            } else HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth(), pageSpacing = 12.dp,
                // Keep the adjacent Deck ready before a swipe instead of composing all tiles mid-gesture.
                beyondViewportPageCount = 1,
                key = { index -> if (index == 0) "panel" else layout.pages.getOrNull(index - 1)?.id ?: "keys" }) { page ->
                if (page == 0) {
                    DeckDashboard(peer, foreground, quickKeys, running, data, loadError, selectKey,
                        layout = layout,
                        onConnect = onConnect, onRetry = { refresh++ },
                        onEditQuick = beginQuickEdit,
                        onMedia = { id, label ->
                            if (data?.shortcutsAllowed != true) result = "PC’de Cihazlar bölümünden Kısayollar iznini aç."
                            else execute(label) { client.executeDeckCommand(id) }
                        })
                } else if (page <= layout.pages.size) {
                    val screen = layout.pages[page - 1]
                    val screenKeys = if (screen.quickIds == null) availableKeys.take(QUICK_SLOT_LIMIT)
                        else screen.quickIds.mapNotNull { id -> availableKeys.find { it.identity == id } }
                    DeckDashboard(peer, foreground, screenKeys, running, data, loadError, selectKey,
                        layout = layout.copy(widgets = screen.widgets, quickIds = screen.quickIds, quickIdsSpecified = true),
                        onConnect = onConnect, onRetry = { refresh++ },
                        onEditQuick = beginQuickEdit,
                        onMedia = { id, label ->
                            if (data?.shortcutsAllowed == true) execute(label) { client.executeDeckCommand(id) }
                            else result = "PC'de Kısayollar iznini aç."
                        })
                } else {
                    if (shortcutKeys.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (paired && data != null && loadError == null && layout.shortcutIds != null) {
                            Text("Bu ekranda kısayol yok. Düzenleyerek ekleyebilirsin.", color = muted)
                        } else DeckNotice(paired, peer.connected, data != null, loadError, onConnect) { refresh++ }
                    } else {
                        BoxWithConstraints(Modifier.fillMaxSize()) {
                            val rowHeight = ((maxHeight - deckSpacing * 2) / 3).coerceAtLeast(48.dp)
                            LazyVerticalGrid(columns = GridCells.Fixed(if (denseGrid) 5 else 4),
                                state = shortcutScroll, modifier = Modifier.fillMaxSize(),
                                verticalArrangement = Arrangement.spacedBy(deckSpacing),
                                horizontalArrangement = Arrangement.spacedBy(deckSpacing)) {
                                items(shortcutKeys, key = { it.identity }) { key ->
                                    DeckTile(key, denseGrid, !running, { selectKey(key) },
                                        Modifier.fillMaxWidth().height(rowHeight), layout.hideShortcutNames)
                                }
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().height(48.dp).deckGlass(12.dp).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically) {
                EonRotationButton("Dikey moda geç", onPortrait, enabled = !savingQuick && !savingLayout)
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    if (running) CircularProgressIndicator(Modifier.size(13.dp), strokeWidth = 2.dp, color = teal)
                    else Box(Modifier.size(7.dp).background(if (paired) teal else amber, CircleShape))
                    Text(result ?: when {
                        running -> "Gönderiliyor…"
                            pager.currentPage == 0 && paired && layoutError != null -> "Deck eşitlenemedi: $layoutError"
                            pager.currentPage == 0 && paired && remoteLayout == null -> "PC Deck düzeni eşitleniyor…"
                        else -> stateText
                    },
                        style = MaterialTheme.typography.labelMedium, color = muted, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
                if (choosingPage) AlertDialog(
                    onDismissRequest = { choosingPage = false },
                    title = { Text("Ekranlar") },
                    text = { LazyColumn(Modifier.heightIn(max = 360.dp)) {
                        items(pager.pageCount) { index ->
                            TextButton(onClick = { choosingPage = false; scope.launch { pager.scrollToPage(index) } },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Text(pageTitle(index), color = if (pager.currentPage == index) teal else muted)
                            }
                        }
                    } },
                    confirmButton = { TextButton(onClick = { choosingPage = false }) { Text("Kapat") } },
                )
                if (!editingQuick && !editingLayout) {
                    val selectedPage = pager.settledPage
                    IconButton(onClick = { scope.launch { pager.animateScrollToPage(selectedPage - 1) } },
                        enabled = selectedPage > 0) {
                        Icon(Icons.Rounded.KeyboardArrowLeft, "Önceki ekran")
                    }
                    TextButton(onClick = { choosingPage = true }, modifier = Modifier.widthIn(max = 160.dp).height(48.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp)) {
                        Text(pageTitle(selectedPage), color = teal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.Rounded.ArrowDropDown, "Ekranları seç", Modifier.size(17.dp))
                    }
                    IconButton(onClick = { scope.launch { pager.animateScrollToPage(selectedPage + 1) } },
                        enabled = selectedPage < pager.pageCount - 1) {
                        Icon(Icons.Rounded.KeyboardArrowRight, "Sonraki ekran")
                    }
                    if (shortcutsSelected) {
                        TextButton(onClick = {
                            denseGrid = !denseGrid
                            preferences.edit().putBoolean("denseGrid", denseGrid).apply()
                        }, modifier = Modifier.height(48.dp).semantics {
                            contentDescription = if (denseGrid) "4 sütunlu dizilime geç" else "5 sütunlu dizilime geç"
                        }, contentPadding = PaddingValues(horizontal = 5.dp)) {
                            Text(if (denseGrid) "5 sütun" else "4 sütun", fontSize = 11.sp, color = teal)
                        }
                    } else {
                        if (layoutError != null) IconButton(onClick = { layoutRefresh++ }) {
                            Icon(Icons.Rounded.SyncProblem, "Panel eşitlemesini yeniden dene", Modifier.size(20.dp))
                        }
                        IconButton(onClick = beginLayoutEdit, enabled = paired && data != null) {
                            Icon(Icons.Rounded.DashboardCustomize, "12×6 panel bileşenlerini düzenle", Modifier.size(20.dp))
                        }
                    }
                    IconButton(onClick = beginQuickEdit, enabled = if (shortcutsSelected) layoutEditable else paired && data != null) {
                        Icon(Icons.Rounded.Tune, if (shortcutsSelected) "Kısayollar ekranını düzenle"
                            else "Altı hızlı eylemi seç ve sırala", Modifier.size(20.dp))
                    }
                }

            }
        }
    }
    confirm?.let { key ->
        AlertDialog(onDismissRequest = { confirm = null }, title = { Text(key.label) },
            text = { Text("Bu işlem ${peer.name} bilgisayarında çalıştırılacak.") },
            confirmButton = { TextButton(enabled = paired && !running, onClick = {
                confirm = null
                runKey(key)
            }) { Text("Çalıştır") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Vazgeç") } })
    }
    layoutConflict?.let { current ->
        AlertDialog(onDismissRequest = { /* Keep the pending revision visible. */ },
            title = { Text("Panel düzeni değişti") },
            text = { Text("Bilgisayarda başka bir düzen kaydedildi (revizyon ${current.revision}). Güncel düzeni yüklemek için değişikliklerini bırakabilirsin.") },
            confirmButton = {
                TextButton(onClick = {
                    layout = current
                    remoteLayout = current
                    draftLayout = editingLayoutPageId?.let { id -> current.pages.find { it.id == id }?.widgets }
                        ?: current.widgets
                    draftBaseRevision = current.revision
                    layoutPreferenceKey?.let { preferences.edit().putString(it, current.toJson()).apply() }
                    layoutConflict = null
                    result = "Güncel PC düzeni yüklendi."
                }) { Text("PC düzenini yükle") }
            },
            dismissButton = {
                TextButton(onClick = { discardLayout() }) { Text("Düzenlemeyi bırak") }
            })
    }
    quickConflict?.let { latest ->
        AlertDialog(onDismissRequest = { }, title = { Text("Kısayollar PC'de değişti") },
            text = { Text("PC düzeninin revizyonu ${latest.revision}. PC'deki düzeni yükleyebilir veya değişikliklerine dönüp yeniden kaydedebilirsin.") },
            confirmButton = {
                TextButton(onClick = {
                    layout = latest
                    remoteLayout = latest
                    if (!editingShortcuts && editingQuickPageId == null) {
                        storedQuickIds = latest.quickIds
                        peerPreferenceKey?.let { key -> preferences.edit().apply {
                            if (latest.quickIds == null) remove(key) else putString(key, encodeQuickIds(latest.quickIds))
                            putBoolean("syncedQuickV1_$key", true)
                            putBoolean("pendingQuickV1_$key", false)
                        }.apply() }
                    }
                    editingQuick = false
                    layoutPreferenceKey?.let { preferences.edit().putString(it, latest.toJson()).apply() }
                    quickConflict = null
                }) { Text("PC sürümünü yükle") }
            }, dismissButton = {
                TextButton(onClick = {
                    if (editingShortcuts && !shortcutSelectionChanged) {
                        draftQuickIds = latest.shortcutIds ?: distinctKeys.map { it.identity }
                        draftHideShortcutNames = latest.hideShortcutNames
                    }
                    shortcutEditBase = latest
                    quickConflict = null
                }) { Text("Değişikliklerime dön") }
            })
    }
}

@Composable
private fun DeckQuickEditor(
    hideShortcutNames: Boolean,
    onHideNamesChange: (Boolean) -> Unit,
    namesEditable: Boolean,
    shortcutScreen: Boolean,
    saving: Boolean,
    canSave: Boolean,
    knownKeys: List<DeckKey>,
    authorised: List<DeckKey>,
    selectedIds: List<String>,
    onChange: (List<String>) -> Unit,
    onSave: () -> Unit,
    onReset: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    val keysById = remember(knownKeys) { knownKeys.associateBy { it.identity } }
    val selected = remember(selectedIds, keysById) { selectedIds.map { id ->
        keysById[id] ?: DeckKey(id.substringAfter(':'), id, if (id.startsWith("tool:")) "folder" else "application", false)
    } }
    val canAdd = !saving && (shortcutScreen || selectedIds.size < QUICK_SLOT_LIMIT)
    val addedIds = selected.map { it.identity }.toSet()
    val addable = authorised.filterNot { it.identity in addedIds }
    val move: (String, Int) -> Unit = { id, direction ->
        val index = selectedIds.indexOf(id)
        val next = index + direction
        if (!saving && index >= 0 && next in selectedIds.indices) {
            val changed = selectedIds.toMutableList()
            changed.add(next, changed.removeAt(index))
            onChange(changed)
        }
    }
    val remove: (String) -> Unit = { id -> if (!saving) onChange(selectedIds.filterNot { it == id }) }
    val add: (String) -> Unit = { id ->
        if (canAdd && id !in selectedIds) onChange(selectedIds + id)
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (shortcutScreen) "KISAYOLLAR EKRANINI DÜZENLE" else "HIZLI ERİŞİMİ DÜZENLE", fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (shortcutScreen) "${selected.size} seçili · Oklarla sırala, + ile ekle"
                    else "${selected.size}/$QUICK_SLOT_LIMIT seçili · Oklarla sırala, + ile ekle",
                    fontSize = 10.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            TextButton(onClick = onReset, enabled = canSave, modifier = Modifier.heightIn(min = 48.dp),
                contentPadding = PaddingValues(horizontal = 7.dp)) { Text("Varsayılan", fontSize = 11.sp) }
            TextButton(onClick = onCancel, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp),
                contentPadding = PaddingValues(horizontal = 7.dp)) { Text("Vazgeç", fontSize = 11.sp) }
            Button(shape = MaterialTheme.shapes.medium, onClick = onSave, enabled = canSave, modifier = Modifier.heightIn(min = 48.dp),
                contentPadding = PaddingValues(horizontal = 13.dp)) { Text("Kaydet", fontSize = 11.sp) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = hideShortcutNames, onCheckedChange = onHideNamesChange, enabled = namesEditable,
                modifier = Modifier.semantics { contentDescription = "Kısayol adlarını gizle (tüm ekranlar)" })
            Text("Kısayol adlarını gizle (tüm ekranlar)", style = MaterialTheme.typography.labelMedium)
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            if (maxWidth >= 630.dp) {
                Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    DeckSelectedEditorPanel(selected, move, remove, Modifier.weight(1.1f).fillMaxHeight())
                    DeckAvailableEditorPanel(addable, canAdd, add,
                        Modifier.weight(.9f).fillMaxHeight())
                }
            } else {
                var showAvailable by remember { mutableStateOf(false) }
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !showAvailable, onClick = { showAvailable = false },
                            label = { Text("Seçilenler (${selected.size})") }, modifier = Modifier.heightIn(min = 48.dp))
                        FilterChip(selected = showAvailable, onClick = { showAvailable = true },
                            label = { Text("Eklenecekler (${addable.size})") }, modifier = Modifier.heightIn(min = 48.dp))
                    }
                    if (showAvailable) {
                        DeckAvailableEditorPanel(addable, canAdd, add,
                            Modifier.weight(1f).fillMaxWidth())
                    } else {
                        DeckSelectedEditorPanel(selected, move, remove, Modifier.weight(1f).fillMaxWidth())
                    }
                }
            }
        }
    }
}

@Composable
private fun DeckSelectedEditorPanel(
    selected: List<DeckKey>,
    onMove: (String, Int) -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier
) {
    Surface(modifier.deckGlass(), shape = eonPanelShape, color = Color.Transparent) {
        Column(Modifier.fillMaxSize().padding(7.dp)) {
            SectionCaption("PANELDEKİLER", "SIRALA VEYA KALDIR", Modifier.fillMaxWidth().height(23.dp))
            if (selected.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Henüz kısayol seçilmedi. Ekle bölümünden komut seç.", color = muted,
                        textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    itemsIndexed(selected, key = { _, key -> key.identity }) { index, key ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp)
                            .background(surfaceHigh, MaterialTheme.shapes.small).padding(start = 9.dp, end = 2.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(key.icon, null, Modifier.size(20.dp), tint = key.tint)
                            Spacer(Modifier.width(8.dp))
                            Column(Modifier.weight(1f)) {
                                Text(key.label, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 13.sp)
                                if (!key.available || !key.approved) {
                                    Text("PC izni gerekli", color = coral, fontSize = 9.sp, maxLines = 1)
                                }
                            }
                            IconButton(onClick = { onMove(key.identity, -1) }, enabled = index > 0,
                                modifier = Modifier.size(48.dp)) {
                                Icon(Icons.Rounded.KeyboardArrowUp, "${key.label} yukarı taşı", Modifier.size(21.dp))
                            }
                            IconButton(onClick = { onMove(key.identity, 1) }, enabled = index < selected.lastIndex,
                                modifier = Modifier.size(48.dp)) {
                                Icon(Icons.Rounded.KeyboardArrowDown, "${key.label} aşağı taşı", Modifier.size(21.dp))
                            }
                            IconButton(onClick = { onRemove(key.identity) }, modifier = Modifier.size(48.dp)) {
                                Icon(Icons.Rounded.Close, "${key.label} hızlı panelden kaldır",
                                    Modifier.size(19.dp), tint = coral)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeckAvailableEditorPanel(
    candidates: List<DeckKey>,
    canAdd: Boolean,
    onAdd: (String) -> Unit,
    modifier: Modifier
) {
    Surface(modifier.deckGlass(), shape = eonPanelShape, color = Color.Transparent) {
        Column(Modifier.fillMaxSize().padding(7.dp)) {
            SectionCaption("EKLENEBİLİR", "${candidates.size} İZİNLİ EYLEM", Modifier.fillMaxWidth().height(23.dp))
            if (candidates.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Eklenebilecek başka kısayol yok.",
                        color = muted, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    items(candidates, key = { it.identity }) { key ->
                        Surface(onClick = { onAdd(key.identity) }, enabled = canAdd,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
                            shape = MaterialTheme.shapes.small, color = surfaceHigh) {
                            Row(Modifier.fillMaxSize().padding(horizontal = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                                Icon(key.icon, null, Modifier.size(20.dp), tint = key.tint)
                                Text(key.label, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                                Icon(if (canAdd) Icons.Rounded.AddCircleOutline else Icons.Rounded.Lock,
                                    "${key.label} hızlı erişime ekle", Modifier.size(23.dp), tint = if (canAdd) teal else muted)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionCaption(title: String, detail: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.labelSmall, color = ink, fontWeight = FontWeight.ExtraBold,
            letterSpacing = .9.sp, maxLines = 1)
        Text(detail, style = MaterialTheme.typography.labelSmall, color = muted, fontSize = 9.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun DeckDashboard(peer: EonPeerStatus, foreground: Boolean, keys: List<DeckKey>, running: Boolean,
    data: DeckData?, error: String?, onKey: (DeckKey) -> Unit, onConnect: () -> Unit, onRetry: () -> Unit,
    onEditQuick: () -> Unit, onMedia: (String, String) -> Unit, layout: DeckLayout) {
    DeckLayoutCanvas(layout.widgets, peer, foreground, keys, running, data, error, onKey, onConnect,
        onRetry, onEditQuick, onMedia, Modifier.fillMaxSize(), hideShortcutNames = layout.hideShortcutNames)
}

private fun layoutWidgetTitle(id: String): String = when (id) {
    "clock" -> "Saat"
    "cpu" -> "İşlemci"
    "gpu" -> "Ekran kartı"
    "ram" -> "Bellek"
    "disk" -> "Disk"
    "media" -> "Medya"
    else -> "Hızlı erişim"
}

/** Exact 12×6 responsive canvas; pixels are derived from the available landscape bounds. */
@Composable
private fun DeckLayoutCanvas(widgets: List<DeckWidget>, peer: EonPeerStatus, foreground: Boolean,
    keys: List<DeckKey>, running: Boolean, data: DeckData?, error: String?, onKey: (DeckKey) -> Unit,
    onConnect: () -> Unit, onRetry: () -> Unit, onEditQuick: () -> Unit,
    onMedia: (String, String) -> Unit, modifier: Modifier, editing: Boolean = false,
    selected: String = "clock", onSelect: (String) -> Unit = {}, hideShortcutNames: Boolean = false) {
    BoxWithConstraints(modifier.clipToBounds()) {
        val cellWidth = maxWidth / DECK_COLUMNS
        val cellHeight = maxHeight / DECK_ROWS
        if (editing) {
            Canvas(Modifier.fillMaxSize()) {
                val grid = Color.Gray.copy(alpha = .18f)
                for (x in 1 until DECK_COLUMNS) {
                    val dx = size.width * x / DECK_COLUMNS
                    drawLine(grid, androidx.compose.ui.geometry.Offset(dx, 0f),
                        androidx.compose.ui.geometry.Offset(dx, size.height), strokeWidth = 1f)
                }
                for (y in 1 until DECK_ROWS) {
                    val dy = size.height * y / DECK_ROWS
                    drawLine(grid, androidx.compose.ui.geometry.Offset(0f, dy),
                        androidx.compose.ui.geometry.Offset(size.width, dy), strokeWidth = 1f)
                }
            }
        }
        val system = peer.system.takeIf { peer.connected && peer.paired }
        for (widget in widgets) {
            if (!widget.visible && (!editing || widget.id != selected)) continue
            val position = Modifier.offset(x = cellWidth * widget.x, y = cellHeight * widget.y)
                .size(width = cellWidth * widget.w, height = cellHeight * widget.h)
                .padding(
                    start = if (widget.x == 0) 0.dp else deckSpacing / 2,
                    top = if (widget.y == 0) 0.dp else deckSpacing / 2,
                    end = if (widget.x + widget.w == DECK_COLUMNS) 0.dp else deckSpacing / 2,
                    bottom = if (widget.y + widget.h == DECK_ROWS) 0.dp else deckSpacing / 2,
                )
            Box(position) {
                if (widget.visible) {
                    when (widget.id) {
                        "clock" -> DeckClock(foreground, Modifier.fillMaxSize().deckGlass(accent = blue))
                        "cpu" -> Gauge("CPU", system?.optJSONObject("cpu"), teal, Modifier.fillMaxSize())
                        "gpu" -> {
                            val temp = data?.gpu?.optInt("temperatureC", -1) ?: -1
                            Gauge(if (temp >= 0) "GPU ${temp}°" else "GPU", data?.gpu, blue, Modifier.fillMaxSize())
                        }
                        "ram" -> Gauge("RAM", system?.optJSONObject("memory"), violet, Modifier.fillMaxSize())
                        "disk" -> Gauge("DİSK", system?.optJSONObject("disk"), amber, Modifier.fillMaxSize())
                        "media" -> DeckMedia(data, running, onMedia, Modifier.fillMaxSize())
                        "shortcuts" -> if (keys.isNotEmpty()) {
                            BoxWithConstraints(Modifier.fillMaxSize()) {
                                if (maxWidth < 175.dp || maxHeight < 112.dp) {
                                    Row(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(deckSpacing)) {
                                        keys.forEach { key ->
                                            DeckTile(key, true, !running, { onKey(key) },
                                                Modifier.width(98.dp).fillMaxHeight(), hideShortcutNames)
                                        }
                                    }
                                } else KeyMatrix(keys, 3, 2, running, onKey, Modifier.fillMaxSize(), compact = true, hideShortcutNames = hideShortcutNames)
                            }
                        } else if (data == null || error != null || !peer.connected || !peer.paired) {
                            DeckNotice(peer.connected && peer.paired, peer.connected, data != null, error, onConnect, onRetry)
                        } else Box(Modifier.fillMaxSize().deckGlass()) {
                            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center) {
                                Text("Hızlı tuş seçilmedi", color = muted, style = MaterialTheme.typography.labelMedium)
                                TextButton(onClick = onEditQuick) { Text("Kısayolları düzenle") }
                            }
                        }
                    }
                }
                if (editing) {
                    Box(Modifier.fillMaxSize().border(if (widget.id == selected) 2.dp else 1.dp,
                        if (widget.id == selected) teal else border.copy(alpha = .55f), eonPanelShape)
                        .background(if (widget.visible) Color.Transparent else surfaceHigh.copy(alpha = .65f), eonPanelShape)
                        .clickable { onSelect(widget.id) }, contentAlignment = Alignment.Center) {
                        if (widget.id == selected || !widget.visible) {
                            Surface(color = if (widget.id == selected) teal else surfaceHigh,
                                shape = MaterialTheme.shapes.small) {
                                Text("${layoutWidgetTitle(widget.id)}${if (widget.visible) "" else " (gizli)"}",
                                    Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                    color = if (widget.id == selected) MaterialTheme.colorScheme.onPrimary else ink,
                                    fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeckLayoutEditor(widgets: List<DeckWidget>, selectedId: String, onSelect: (String) -> Unit,
    onChange: (DeckWidget) -> Unit, onSave: () -> Unit, onCancel: () -> Unit, onReset: () -> Unit,
    canSave: Boolean, saving: Boolean, offline: Boolean, error: String?, peer: EonPeerStatus,
    foreground: Boolean, keys: List<DeckKey>, running: Boolean, data: DeckData?,
    onKey: (DeckKey) -> Unit, onMedia: (String, String) -> Unit, modifier: Modifier) {
    BoxWithConstraints(modifier) {
        val availableWidth = maxWidth
        if (availableWidth >= 490.dp) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DeckLayoutCanvas(widgets, peer, foreground, keys, running, data, null, onKey,
                    {}, {}, {}, onMedia, Modifier.weight(1f).fillMaxHeight(), editing = true,
                    selected = selectedId, onSelect = onSelect)
                DeckLayoutTools(widgets, selectedId, onSelect, onChange, onSave, onCancel, onReset,
                    canSave, saving, offline, error,
                    Modifier.width(if (availableWidth < 620.dp) 220.dp else 265.dp).fillMaxHeight())
            }
        } else {
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                DeckLayoutCanvas(widgets, peer, foreground, keys, running, data, null, onKey,
                    {}, {}, {}, onMedia, Modifier.weight(1f).fillMaxWidth(), editing = true,
                    selected = selectedId, onSelect = onSelect)
                DeckLayoutTools(widgets, selectedId, onSelect, onChange, onSave, onCancel, onReset,
                    canSave, saving, offline, error, Modifier.height(160.dp).fillMaxWidth())
            }
        }
    }
}

@Composable
private fun DeckLayoutTools(widgets: List<DeckWidget>, selectedId: String, onSelect: (String) -> Unit,
    onChange: (DeckWidget) -> Unit, onSave: () -> Unit, onCancel: () -> Unit, onReset: () -> Unit,
    canSave: Boolean, saving: Boolean, offline: Boolean, error: String?, modifier: Modifier) {
    val current = widgets.firstOrNull { it.id == selectedId } ?: widgets.first()
    val index = widgets.indexOfFirst { it.id == current.id }
    Surface(modifier.deckGlass(), color = Color.Transparent, shape = eonPanelShape) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 9.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("12×6 PANEL DÜZENİ", fontWeight = FontWeight.ExtraBold,
                style = MaterialTheme.typography.labelMedium, color = teal)
            if (offline || error != null) Text(
                if (offline) "Çevrimdışı · Bağlantı gelince kaydet" else "PC bağlantısı: $error",
                color = amber, style = MaterialTheme.typography.labelSmall)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onSelect(widgets[(index - 1 + widgets.size) % widgets.size].id) },
                    modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.ChevronLeft, "Önceki bileşen") }
                Text(layoutWidgetTitle(current.id), Modifier.weight(1f), textAlign = TextAlign.Center,
                    fontWeight = FontWeight.Bold, maxLines = 1)
                IconButton(onClick = { onSelect(widgets[(index + 1) % widgets.size].id) },
                    modifier = Modifier.size(48.dp)) { Icon(Icons.Rounded.ChevronRight, "Sonraki bileşen") }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Görünür", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                Switch(checked = current.visible, onCheckedChange = { onChange(current.copy(visible = it)) })
            }
            Text("Konum · X ${current.x + 1}  Y ${current.y + 1}", style = MaterialTheme.typography.labelSmall, color = muted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onChange(current.copy(x = current.x - 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.ArrowBack, "Sola taşı")
                }
                IconButton(onClick = { onChange(current.copy(y = current.y - 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.ArrowUpward, "Yukarı taşı")
                }
                IconButton(onClick = { onChange(current.copy(y = current.y + 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.ArrowDownward, "Aşağı taşı")
                }
                IconButton(onClick = { onChange(current.copy(x = current.x + 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.ArrowForward, "Sağa taşı")
                }
            }
            Text("Boyut · ${current.w} sütun × ${current.h} satır", style = MaterialTheme.typography.labelSmall, color = muted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onChange(current.copy(w = current.w - 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.Remove, "Genişliği azalt")
                }
                IconButton(onClick = { onChange(current.copy(w = current.w + 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.Add, "Genişliği artır")
                }
                IconButton(onClick = { onChange(current.copy(h = current.h - 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.KeyboardArrowDown, "Yüksekliği azalt")
                }
                IconButton(onClick = { onChange(current.copy(h = current.h + 1)) }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.KeyboardArrowUp, "Yüksekliği artır")
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = onReset, modifier = Modifier.heightIn(min = 48.dp)) { Text("Sıfırla") }
                TextButton(onClick = onCancel, modifier = Modifier.heightIn(min = 48.dp)) { Text("Vazgeç") }
                Button(shape = MaterialTheme.shapes.medium, onClick = onSave, enabled = canSave, modifier = Modifier.heightIn(min = 48.dp)) {
                    if (saving) CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 2.dp)
                    else Text("Kaydet")
                }
            }
        }
    }
}

@Composable
private fun DeckClock(foreground: Boolean, modifier: Modifier) {
    val locale = LocalConfiguration.current.locales[0]
    val clock = remember(locale) { SimpleDateFormat("HH:mm", locale) }
    val date = remember(locale) { SimpleDateFormat("d MMMM EEEE", locale) }
    var now by remember { mutableStateOf(Date()) }
    LaunchedEffect(foreground) { while (foreground) { now = Date(); delay(15_000) } }
    BoxWithConstraints(modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        val size = minOf(maxWidth.value * .27f, maxHeight.value * .60f).coerceIn(16f, 60f).sp
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(clock.format(now), fontSize = size, lineHeight = size, letterSpacing = (-1.8).sp,
                style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"),
                fontWeight = FontWeight.Medium, maxLines = 1)
            Text(date.format(now), color = muted, fontSize = 11.sp, lineHeight = 13.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Gauge(label: String, value: JSONObject?, accent: Color, modifier: Modifier) {
    val number = value?.takeIf { it.has("usagePercent") && !it.isNull("usagePercent") }
        ?.optDouble("usagePercent")?.takeIf { it.isFinite() }?.coerceIn(0.0, 100.0)
    Column(modifier.deckGlass(accent = accent).padding(horizontal = 10.dp, vertical = 6.dp).semantics(mergeDescendants = true) {
        if (number != null) progressBarRangeInfo = ProgressBarRangeInfo(number.toFloat(), 0f..100f)
        else stateDescription = "Veri yok"
    }, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, color = muted, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Box(Modifier.size(5.dp).background(accent.copy(alpha = if (number == null) .4f else 1f), CircleShape))
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val diameter = minOf(maxWidth, maxHeight, 92.dp)
            Box(Modifier.size(diameter), contentAlignment = Alignment.Center) {
                Canvas(Modifier.fillMaxSize().padding(5.dp)) {
                    val stroke = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round)
                    drawArc(accent.copy(alpha = .19f), 135f, 270f, useCenter = false, style = stroke)
                    if (number != null && number > 0) {
                        drawArc(accent, 135f, (number * 2.7).toFloat(), useCenter = false, style = stroke)
                    }
                }
                Text(number?.let { "${it.toInt()}%" } ?: "—",
                    fontSize = (diameter.value * .25f).coerceIn(11f, 18f).sp,
                    style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"),
                    fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

@Composable
private fun DeckMedia(data: DeckData?, running: Boolean, onMedia: (String, String) -> Unit,
    modifier: Modifier) {
    val detail = when {
        data == null -> "Bağlantı bekleniyor"
        !data.shortcutsAllowed -> "PC izni gerekli"
        !data.mediaAvailable -> "Medya kontrolü kullanılamıyor"
        data.mediaChecked && data.media == null -> "Bir müzik uygulamasında parça aç"
        else -> "Windows medyası"
    }
    EonMediaPlayer(media = data?.media,
        enabled = data?.shortcutsAllowed == true && data.mediaAvailable && !running,
        detail = detail, onMedia = onMedia, modifier = modifier, deck = true)
}

@Composable
private fun KeyMatrix(keys: List<DeckKey>, columns: Int, rows: Int, running: Boolean, onKey: (DeckKey) -> Unit,
    modifier: Modifier = Modifier, compact: Boolean = false, hideShortcutNames: Boolean = false) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(deckSpacing)) {
        repeat(rows) { row ->
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(deckSpacing)) {
                repeat(columns) { column ->
                    val key = keys.getOrNull(row * columns + column)
                    val slot = Modifier.weight(1f).fillMaxHeight()
                    if (key == null) Spacer(slot) else DeckTile(key, compact, !running, { onKey(key) }, slot, hideShortcutNames)
                }
            }
        }
    }
}

@Composable
private fun DeckTile(key: DeckKey, compact: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier, hideShortcutNames: Boolean = false) {
    val countdown = powerCountdown(key.deadline)
    val radius = if (compact) 8.dp else 10.dp
    val shape = remember(radius) { RoundedCornerShape(radius) }
    val tint = if (countdown != null) teal else if (key.available && key.approved) key.tint else muted
    Surface(onClick = onClick, enabled = enabled, modifier = modifier.deckGlass(radius, tint).semantics {
        if (countdown != null) {
            contentDescription = "${key.label} · Durdur"
            stateDescription = countdown
        }
    }, shape = shape, color = Color.Transparent) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            if (countdown != null) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Icon(Icons.Rounded.Stop, null, Modifier.size(if (compact) 20.dp else 24.dp), tint = tint)
                    Text(countdown, color = ink, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                        maxLines = 1)
                }
            } else if (hideShortcutNames) {
                Icon(key.icon, key.label, Modifier.align(Alignment.Center).size(if (compact) 25.dp else 30.dp), tint = tint)
            } else if (compact && maxWidth < 118.dp) {
                Column(Modifier.align(Alignment.Center).padding(horizontal = 5.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(key.icon, null, Modifier.size(21.dp), tint = tint)
                    Text(key.label, color = if (key.available && key.approved) ink else muted,
                        textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            } else if (compact) {
                Row(Modifier.align(Alignment.CenterStart).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Icon(key.icon, null, Modifier.size(20.dp), tint = tint)
                    Text(key.label, color = if (key.available && key.approved) ink else muted,
                        maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 10.sp,
                        lineHeight = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                }
            } else {
                Column(Modifier.align(Alignment.Center).padding(horizontal = 7.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Icon(key.icon, null, Modifier.size(25.dp), tint = tint)
                    Text(key.label, color = if (key.available && key.approved) ink else muted,
                        textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                }
            }
            if (!key.available || !key.approved) Icon(Icons.Rounded.Lock, "İzin gerekli",
                Modifier.align(Alignment.TopEnd).padding(5.dp).size(12.dp), tint = muted)
        }
    }
}

@Composable
private fun DeckNotice(paired: Boolean, connected: Boolean, loaded: Boolean, error: String?,
    onConnect: () -> Unit, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize().deckGlass(), contentAlignment = Alignment.Center) {
        Column(Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center) {
            val label = when {
                !connected -> "Bilgisayara bağlan"
                !paired -> "Eşleştirme gerekli"
                error != null -> "Panel yüklenemedi: $error"
                loaded -> "Henüz kısayol yok"
                else -> "Komutlar yükleniyor…"
            }
            Text(label, maxLines = 2, overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium)
            if (!paired || error != null) {
                TextButton(onClick = if (paired) onRetry else onConnect,
                    modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(if (paired) "Tekrar dene" else "Bağlantıyı aç", color = teal)
                }
            } else if (!loaded) {
                Spacer(Modifier.height(6.dp))
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = teal)
            }
        }
    }
}
