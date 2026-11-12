package com.kapanis.mobil.eon2.ui

import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.kapanis.mobil.eon2.network.IncomingDownloads
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.semantics.Role
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import android.content.res.Configuration
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kapanis.mobil.eon2.data.EonLocalNote
import com.kapanis.mobil.eon2.data.EonNoteConflict
import com.kapanis.mobil.eon2.data.EonNotesRepository
import com.kapanis.mobil.eon2.network.EonPeerStatus
import com.kapanis.mobil.eon2.network.EonUsbClient
import com.kapanis.mobil.eon2.network.UsbPrompt
import com.kapanis.mobil.eon2.network.DesktopSettings
import com.kapanis.mobil.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class EonTab(val label: String, val icon: ImageVector) {
    Dashboard("Panel", Icons.Rounded.Dashboard),
    Controls("Kontrol", Icons.Rounded.Bolt),
    Notes("Notlar", Icons.Rounded.NoteAlt),
    Settings("Ayarlar", Icons.Rounded.Settings),
}

private enum class ControlPage { Overview, Actions, Files }

private val Green = Color(0xFF7BD2A4)

private fun Context.eonActivity(): Activity? {
    var current: Context = this
    while (true) {
        if (current is Activity) return current
        current = (current as? ContextWrapper)?.baseContext ?: return null
    }
}

@Composable
fun Eon2Screen(theme: String, onTheme: (String) -> Unit) {
    val context = LocalContext.current
    val activity = remember(context) { context.eonActivity() }
    val store = remember { EonNotesRepository.shared(context.applicationContext) }
    val client = remember { EonUsbClient(context.applicationContext, store) }
    val downloads = remember(client) { IncomingDownloads(context.applicationContext, client) }
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf(EonTab.Dashboard) }
    var controlPage by remember { mutableStateOf(ControlPage.Overview) }
    var peer by remember { mutableStateOf(EonPeerStatus(false, "Bilgisayar aranıyor", false)) }
    var notes by remember { mutableStateOf<List<EonLocalNote>>(emptyList()) }
    var selected by remember { mutableStateOf<EonLocalNote?>(null) }
    var selectedConflict by remember { mutableStateOf<EonNoteConflict?>(null) }
    var createNew by rememberSaveable { mutableStateOf(false) }
    var pairingPrompt by remember { mutableStateOf<UsbPrompt?>(null) }
    var outgoingToken by remember { mutableStateOf<String?>(null) }
    var answering by remember { mutableStateOf(false) }
    var desktopSettings by remember { mutableStateOf<DesktopSettings?>(null) }
    var settingsBusy by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var foreground by remember { mutableStateOf(true) }
    val lifecycleOwner = LocalLifecycleOwner.current

    var storageRequested by rememberSaveable { mutableStateOf(false) }
    val storagePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) Toast.makeText(context, "Downloads’a kaydetmek için depolama izni gerekli.", Toast.LENGTH_LONG).show()
    }
    LaunchedEffect(peer.paired) {
        if (peer.paired && Build.VERSION.SDK_INT < 29 && !storageRequested &&
            context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            storageRequested = true
            storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }
    LaunchedEffect(downloads) {
        var lastError: String? = null
        while (isActive) {
            if (foreground && peer.connected && peer.paired && (Build.VERSION.SDK_INT >= 29 ||
                context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)) {
                try {
                    val received = withContext(Dispatchers.IO) { downloads.receivePending() }
                    if (received.isNotEmpty()) Toast.makeText(context, "Downloads’a kaydedildi: ${received.joinToString()}", Toast.LENGTH_LONG).show()
                    lastError = null
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    val text = error.message ?: "Dosya alınamadı; bağlantıyı ve boş alanı kontrol et."
                    if (text != lastError) {
                        message = text
                        Toast.makeText(context, text, Toast.LENGTH_LONG).show()
                        lastError = text
                    }
                }
            }
            delay(2000)
        }
    }

    fun requestOrientation(orientation: Int) {
        // Keep the chosen screen orientation until the other mode button is pressed.
        // Releasing automatically can rotate the Deck back while the phone is still sideways.
        activity?.requestedOrientation = orientation
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) foreground = true
            if (event == Lifecycle.Event.ON_STOP) foreground = false
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    suspend fun reloadNotes() { notes = withContext(Dispatchers.IO) { store.list() } }
    suspend fun doSync() {
        if (syncing) return
        syncing = true
        try {
            val result = withContext(Dispatchers.IO) { client.sync() }
            reloadNotes()
            if (result.sent + result.received > 0) {
                message = "Eşitlendi: ${result.sent} gönderildi, ${result.received} alındı."
            }
            if (result.conflicted > 0) message = "${result.conflicted} notta çözülmesi gereken çakışma var."
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { message = error.message ?: "Eşitleme başarısız" }
        finally { syncing = false }
    }

    LaunchedEffect(Unit) {
        reloadNotes()
        while (isActive) {
            if (foreground) {
                peer = withContext(Dispatchers.IO) { client.detect() }
                if (peer.connected && peer.paired && !syncing) doSync()
            }
            delay(if (foreground) 5000 else 12000)
        }
    }

    LaunchedEffect(foreground, peer.connected, peer.transport) {
        while (isActive && foreground && peer.connected && peer.transport == "usb") {
            try {
                val token = outgoingToken
                if (token != null) {
                    val state = withContext(Dispatchers.IO) { client.pairingStatus(token) }
                    if (state != "pending") {
                        outgoingToken = null
                        if (state == "approved") peer = withContext(Dispatchers.IO) { client.detect() }
                        message = when (state) {
                            "approved" -> "Bilgisayar eşleştirmeyi kabul etti."
                            "denied" -> "Bilgisayar eşleştirmeyi reddetti."
                            else -> "Eşleştirme isteğinin süresi doldu."
                        }
                    }
                } else if (!answering) {
                    pairingPrompt = withContext(Dispatchers.IO) { client.pairingPrompt() }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { pairingPrompt = null }
            delay(1000)
        }
        pairingPrompt = null
        if (!peer.connected) outgoingToken = null
    }

    LaunchedEffect(foreground, peer.connected, peer.paired, peer.transport) {
        while (isActive && foreground && peer.connected && peer.paired) {
            if (!settingsBusy) {
                try {
                    val next = withContext(Dispatchers.IO) { client.desktopSettings() }
                    desktopSettings = next
                    next.theme?.let(onTheme)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { desktopSettings = null }
            }
            delay(3000)
        }
    }

    fun updateSetting(key: String, value: Any) {
        if (settingsBusy) return
        if (!peer.connected || !peer.paired) {
            if (key == "theme" && value is String) onTheme(value)
            return
        }
        settingsBusy = true
        scope.launch {
            try {
                val next = withContext(Dispatchers.IO) { client.updateDesktopSettings(key, value) }
                desktopSettings = next
                next.theme?.let(onTheme)
                message = null
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { message = error.message ?: "Ayar kaydedilemedi." }
            finally { settingsBusy = false }
        }
    }

    fun answer(prompt: UsbPrompt, accepted: Boolean) {
        if (answering) return
        answering = true
        scope.launch {
            try {
                val token = client.newPairingToken()
                val state = withContext(Dispatchers.IO) { client.answerPairing(prompt, accepted, token) }
                pairingPrompt = null
                if (state == "approved") peer = withContext(Dispatchers.IO) { client.detect() }
                message = if (state == "approved") "Cihaz eşleştirildi." else "Eşleştirme reddedildi."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { pairingPrompt = null; message = error.message ?: "Eşleştirme tamamlanamadı." }
            finally { answering = false }
        }
    }

    pairingPrompt?.let { prompt ->
        AlertDialog(
            onDismissRequest = { answer(prompt, false) },
            title = { Text("Bilgisayarı eşleştir") },
            text = { Text("${prompt.hostName} Eon’a bağlanmak istiyor.") },
            confirmButton = { TextButton(onClick = { answer(prompt, true) }, enabled = !answering) { Text("Kabul et") } },
            dismissButton = { TextButton(onClick = { answer(prompt, false) }, enabled = !answering) { Text("Reddet") } }
        )
    }

    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    BackHandler(enabled = !landscape && (selected != null || createNew ||
        (tab == EonTab.Controls && controlPage != ControlPage.Overview))) {
        if (tab == EonTab.Controls && controlPage != ControlPage.Overview) controlPage = ControlPage.Overview
        else { selected = null; selectedConflict = null; createNew = false }
    }
    val background = MaterialTheme.colorScheme.background
    val pageStates = rememberSaveableStateHolder()
    val screenBackdrop = rememberLayerBackdrop {
        drawRect(background)
        drawContent()
    }
    if (landscape) {
        LandscapeDeck(
            client = client,
            peer = peer,
            foreground = foreground,
            onConnect = {
                tab = EonTab.Controls
                controlPage = ControlPage.Overview
                selected = null
                selectedConflict = null
                createNew = false
                requestOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
            },
            onPortrait = { requestOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT) },
        )
        return
    }
    Box(Modifier.fillMaxSize()) {
    Scaffold(
        containerColor = Color.Transparent,
        topBar = {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(13.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
                        Image(painterResource(R.drawable.eon_launcher_foreground), "Eon logosu", modifier = Modifier.fillMaxSize())
                    }
                    Text("eon", fontWeight = FontWeight.SemiBold, fontSize = 25.sp, letterSpacing = (-.8).sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { requestOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) },
                        modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.ScreenRotation, "Deck'i yatay aç", modifier = Modifier.size(21.dp))
                    }
                    Surface(modifier = Modifier.eonGlass(RoundedCornerShape(20.dp)), color = Color.Transparent,
                        shape = RoundedCornerShape(20.dp)) {
                        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(7.dp).clip(CircleShape).background(if (peer.connected && peer.paired) Green else Color(0xFFCFA47D)))
                            Spacer(Modifier.width(6.dp))
                            Text(if (peer.connected && peer.paired) "Bağlı" else "Yerel", fontSize = 11.sp)
                        }
                    }
                    IconButton(onClick = { tab = EonTab.Settings }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Rounded.Settings, "Ayarlar", modifier = Modifier.size(19.dp))
                    }
                }
            }
        },

    ) { padding ->
        val navigationVisible = tab != EonTab.Notes || (selected == null && !createNew)
        val contentModifier = Modifier.fillMaxSize().padding(padding)
        val insetContentModifier = contentModifier.padding(bottom = if (navigationVisible) 104.dp else 0.dp)
        Crossfade(
            modifier = Modifier.layerBackdrop(screenBackdrop),
            targetState = tab to (if (tab == EonTab.Controls) controlPage else ControlPage.Overview),
            animationSpec = tween(durationMillis = 160),
            label = "Eon sayfa geçişi",
        ) { (visibleTab, visibleControlPage) ->
        pageStates.SaveableStateProvider(visibleTab to visibleControlPage) {
        when (visibleTab) {
            EonTab.Dashboard -> DashboardContent(contentModifier, peer, notes, onConnect = { tab=EonTab.Controls }, onNotes={tab=EonTab.Notes}, onDeck={requestOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)})
            EonTab.Controls -> when (visibleControlPage) {
                ControlPage.Actions -> PcControlsScreen(client, false, insetContentModifier, onBack = { controlPage = ControlPage.Overview })
                ControlPage.Files -> PcControlsScreen(client, true, insetContentModifier, onBack = { controlPage = ControlPage.Overview })
                ControlPage.Overview -> ControlsContent(insetContentModifier, client, peer, message, answering || outgoingToken != null,
                    onPair = {
                        scope.launch {
                            val token = client.newPairingToken()
                            answering = true
                            try {
                                val state = withContext(Dispatchers.IO) { client.requestPairing(token) }
                                if (state == "pending") {
                                    outgoingToken = token
                                    message = "İsteği bilgisayar ekranında kabul et veya reddet."
                                }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (error: Exception) { message = error.message ?: "Eşleştirme isteği gönderilemedi." }
                            finally { answering = false }
                        }
                    },
                    onOpenPcActions = { controlPage = ControlPage.Actions },
                    onOpenFiles = { controlPage = ControlPage.Files })
            }
            EonTab.Notes -> if (selected?.conflict == true && selectedConflict == null) {
                Column(contentModifier.padding(20.dp), verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Text(message ?: "Not sürümleri yükleniyor…")
                    TextButton(onClick={selected=null}) { Text("Notlara dön") }
                }
            } else if (selected?.conflict == true && selectedConflict != null) {
                EonConflictEditor(contentModifier, selectedConflict!!, onBack={selected=null;selectedConflict=null},
                    onResolve={revisionId,title,body,chooseDeletion,newPath ->
                        scope.launch {
                            try {
                                withContext(Dispatchers.IO) {
                                    val target = selectedConflict ?: error("Çakışma sürümü yok")
                                    store.resolveConflict(target.noteId,target.heads.map { it.revisionId },revisionId,title,body,chooseDeletion,newPath)
                                }
                                selected = null; selectedConflict = null; reloadNotes()
                                message = "Çakışma yeni revizyonla çözüldü."
                                if (peer.paired) doSync()
                            } catch (error: Exception) { message = error.message ?: "Çakışma çözülemedi" }
                        }
                    },message=message)
            } else if (selected != null || createNew) {
                val note = selected
                EonNoteEditor(contentModifier, note, onBack={selected=null;createNew=false}, onSave={title,body ->
                    withContext(Dispatchers.IO) { store.save(note?.id, note?.revisionId, title, body) }
                }, onDelete={
                    if (note != null) withContext(Dispatchers.IO) { store.delete(note.id,note.revisionId) }
                }, onCommitted={
                    selected=null; createNew=false
                    scope.launch { reloadNotes(); if(peer.connected && peer.paired) doSync() }
                }, message=message)
            } else NotesContent(insetContentModifier, notes, onNew={createNew=true;message=null}, onOpen={ note ->
                selected=note;message=null
                if (note.conflict) scope.launch {
                    try { selectedConflict = withContext(Dispatchers.IO) { store.conflict(note.id) } }
                    catch (error: Exception) { message = error.message ?: "Çakışma sürümleri yüklenemedi." }
                } else selectedConflict = null
            })
            EonTab.Settings -> Column(contentModifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp).padding(bottom = 110.dp), verticalArrangement=Arrangement.spacedBy(16.dp)) {
                Text("Ayarlar", style=MaterialTheme.typography.headlineLarge)
                EonAppearancePicker(theme, !settingsBusy) { updateSetting("theme", it) }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
                Text("Bağlantı ve eşitleme", style = MaterialTheme.typography.titleLarge)
                val canManagePc = peer.connected && peer.paired && peer.transport == "usb" && desktopSettings != null && !settingsBusy
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Windows ile aç", Modifier.weight(1f))
                    Switch(checked = desktopSettings?.autostart ?: false, enabled = canManagePc,
                        onCheckedChange = { updateSetting("autostart", it) })
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Tailscale bağlantısı", Modifier.weight(1f))
                    Switch(checked = desktopSettings?.tailscale ?: false, enabled = canManagePc,
                        onCheckedChange = { updateSetting("tailscale", it) })
                }
                if (!canManagePc && !settingsBusy) Text("PC ayarlarını telefondan değiştirmek için USB ile bağlan.",
                    style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick={scope.launch { doSync() }}, enabled=peer.connected && peer.paired && !syncing) {
                    Text(if(syncing) "Eşitleniyor…" else "Notları şimdi eşitle")
                }
                Text("Notlar bağlıyken otomatik eşitlenir.", style=MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick={tab=EonTab.Controls}) { Text("Bağlantıyı yönet") }
                message?.let { Text(it, style=MaterialTheme.typography.bodyMedium) }
            }
        }
        }
        }
    }
    Box(Modifier.align(Alignment.BottomCenter)) {
            if (tab != EonTab.Notes || (selected == null && !createNew)) {
                FloatingEonNavigation(tab, screenBackdrop) { destination ->
                    tab = destination
                    controlPage = ControlPage.Overview
                    selected = null
                    selectedConflict = null
                    createNew = false
                }
            }
    }
    }
}

@Composable
internal fun EonCard(modifier:Modifier=Modifier, content:@Composable ()->Unit) {
    Surface(modifier.eonGlass(), color=Color.Transparent, shape=RoundedCornerShape(24.dp)) { content() }
}

@Composable
private fun FloatingEonNavigation(selected: EonTab, backdrop: Backdrop, onSelect: (EonTab) -> Unit) {
    Box(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth()
                .eonGlass(RoundedCornerShape(32.dp), backdrop, prominent = true),
            shape = RoundedCornerShape(32.dp),
            color = Color.Transparent,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            BoxWithConstraints(Modifier.fillMaxWidth().padding(6.dp)) {
            val slotWidth = maxWidth / EonTab.entries.size
            val position by animateFloatAsState(selected.ordinal.toFloat(),
                animationSpec = tween(260, easing = FastOutSlowInEasing), label = "Sekme merceği")
            val density = androidx.compose.ui.platform.LocalDensity.current
            Box(Modifier.offset { IntOffset(with(density) { (slotWidth * position).roundToPx() }, 0) }
                .width(slotWidth).height(58.dp).clip(RoundedCornerShape(26.dp))
                .background(MaterialTheme.colorScheme.primary.copy(alpha = .12f))
                .border(.75.dp, MaterialTheme.colorScheme.primary.copy(alpha = .22f), RoundedCornerShape(26.dp)))
            Row(Modifier.fillMaxWidth().selectableGroup()) {
                EonTab.entries.forEach { destination ->
                    val isSelected = selected == destination
                    val selectedColor = MaterialTheme.colorScheme.primary
                    val onInactive = MaterialTheme.colorScheme.onSurfaceVariant
                    Column(
                        modifier = Modifier.weight(1f).heightIn(min = 58.dp)
                            .clip(RoundedCornerShape(26.dp))
                            .selectable(selected = isSelected, role = Role.Tab,
                                onClick = { if (!isSelected) onSelect(destination) })
                            .padding(vertical = 7.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(destination.icon, contentDescription = null,
                            tint = if (isSelected) selectedColor else onInactive, modifier = Modifier.size(22.dp))
                        Text(destination.label, fontSize = 11.sp, maxLines = 1,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            color = if (isSelected) selectedColor else onInactive)
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun DashboardContent(modifier: Modifier, peer: EonPeerStatus, notes: List<EonLocalNote>, onConnect: () -> Unit, onNotes: () -> Unit, onDeck: () -> Unit) {
    val connected = peer.connected && peer.paired
    val onSurfaceVariant = MaterialTheme.colorScheme.onSurfaceVariant
    val cpu = peer.system?.optJSONObject("cpu")?.optDouble("usagePercent", Double.NaN)
        ?.takeIf { it.isFinite() && it in 0.0..100.0 }?.toInt()
    val memory = peer.system?.optJSONObject("memory")?.optDouble("usagePercent", Double.NaN)
        ?.takeIf { it.isFinite() && it in 0.0..100.0 }?.toInt()

    Column(
        modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp).padding(bottom = 110.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("Çalışma alanın", style = MaterialTheme.typography.headlineLarge)
            Text("Bilgisayarın ve notların. Hepsi bir arada.",
                style = MaterialTheme.typography.bodyMedium, color = onSurfaceVariant)
        }

        Box(
            Modifier.fillMaxWidth().eonGlass(RoundedCornerShape(28.dp), prominent = true)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = .035f)),
        ) {
            Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(44.dp).clip(RoundedCornerShape(15.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
                        Image(painterResource(R.drawable.eon_launcher_foreground), contentDescription = null, modifier = Modifier.fillMaxSize())
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Eon Desktop", fontWeight = FontWeight.Medium,
                            fontSize = 13.sp, color = onSurfaceVariant)
                        Text(if (connected) "Cihazın hazır" else if (peer.connected) "Eşleştirme gerekli" else "Bağlantı bekleniyor",
                            fontSize = 12.sp, color = onSurfaceVariant)
                    }
                    Box(Modifier.clip(RoundedCornerShape(20.dp))
                        .background(MaterialTheme.colorScheme.secondaryContainer)
                        .padding(horizontal = 11.dp, vertical = 7.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(6.dp).clip(CircleShape)
                                .background(if (connected) Color(0xFF91EFBA) else Color(0xFFFFC18A)))
                            Text(if (connected) "Bağlı" else "Bekliyor", color = MaterialTheme.colorScheme.onSurface, fontSize = 11.sp,
                                fontWeight = FontWeight.Medium)
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
                Text(if (connected) "Bilgisayarınla aynı akışta."
                    else "Masaüstünle bağlantı kur.", color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 24.sp, lineHeight = 29.sp, fontWeight = FontWeight.Bold)
                Text(if (peer.connected) peer.name
                    else "USB kablosuyla bağlan veya eşleştirilmiş Tailscale bağlantını kullan.",
                    fontSize = 12.sp, lineHeight = 18.sp, color = onSurfaceVariant,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                Button(onClick = onDeck, shape = RoundedCornerShape(18.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("Deck’i aç", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(9.dp))
                    Icon(Icons.Rounded.ViewQuilt, null, modifier = Modifier.size(18.dp))
                }
                TextButton(onClick = onConnect, modifier = Modifier.fillMaxWidth()) {
                    Text(if (connected) "Kontrol merkezine git" else "Bağlantıyı yönet")
                    Spacer(Modifier.width(8.dp))
                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(18.dp))
                }
            }
        }

        if (connected) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                DashboardMetric("İşlemci", cpu, Icons.Rounded.Memory, Modifier.weight(1f))
                DashboardMetric("Bellek", memory, Icons.Rounded.Storage, Modifier.weight(1f))
            }
        } else {
            EonCard(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Rounded.Devices, contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Cihazların arasında geçiş yap", fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.bodyMedium)
                        Text("Bilgisayarına bağlanarak kontrol araçlarına eriş.",
                            style = MaterialTheme.typography.bodySmall, color = onSurfaceVariant)
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("Son notlar", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Kaldığın yerden devam et", style = MaterialTheme.typography.bodySmall,
                    color = onSurfaceVariant)
            }
            TextButton(onClick = onNotes) {
                Text("Tüm notlar")
                Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, modifier = Modifier.size(17.dp))
            }
        }

        if (notes.isEmpty()) {
            EonCard(Modifier.fillMaxWidth().clickable(onClickLabel = "Not oluşturmaya başla", onClick = onNotes)) {
                Row(Modifier.fillMaxWidth().padding(19.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(Modifier.size(47.dp).clip(RoundedCornerShape(15.dp))
                        .background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.EditNote, null, tint = MaterialTheme.colorScheme.primary)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("İlk notunu oluştur", fontWeight = FontWeight.SemiBold)
                        Text("Fikirlerini kaydet, cihazların arasında eşitle.",
                            style = MaterialTheme.typography.bodySmall, color = onSurfaceVariant)
                    }
                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, tint = onSurfaceVariant)
                }
            }
        } else {
            notes.take(3).forEach { note ->
                EonCard(Modifier.fillMaxWidth().clickable(onClickLabel = "${note.title} notunu aç", onClick = onNotes)) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                        Box(Modifier.size(42.dp).clip(RoundedCornerShape(13.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                            Icon(if (note.conflict) Icons.Rounded.ErrorOutline else Icons.Rounded.Description,
                                contentDescription = null, tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(21.dp))
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(note.title, style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(if (note.conflict) "Çakışan sürümler gözden geçirilmeli"
                                else note.body.replace('\n', ' ').ifBlank { "Boş not" },
                                style = MaterialTheme.typography.bodySmall, color = onSurfaceVariant,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, null,
                            tint = onSurfaceVariant, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(2.dp))
    }
}

@Composable
private fun DashboardMetric(label: String, percent: Int?, icon: ImageVector, modifier: Modifier = Modifier) {
    EonCard(modifier) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(percent?.let { "$it%" } ?: "—", style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold)
            Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(9.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)) {
                Box(Modifier.fillMaxWidth((percent ?: 0) / 100f).height(5.dp)
                    .clip(RoundedCornerShape(9.dp)).background(MaterialTheme.colorScheme.primary))
            }
        }
    }
}

@Composable
private fun EonConflictEditor(
    modifier: Modifier,
    conflict: EonNoteConflict,
    onBack: () -> Unit,
    onResolve: (String, String, String, Boolean, String?) -> Unit,
    message: String?,
) {
    val initial = conflict.heads.firstOrNull { !it.deleted } ?: conflict.heads.firstOrNull()
    var chosenId by remember(conflict.noteId, conflict.heads) { mutableStateOf(initial?.revisionId ?: "") }
    var title by remember(conflict.noteId, conflict.heads) { mutableStateOf(initial?.title ?: "") }
    var body by remember(conflict.noteId, conflict.heads) { mutableStateOf(initial?.content ?: "") }
    var path by remember(conflict.noteId, conflict.heads) { mutableStateOf(initial?.path ?: "Notes/${conflict.noteId}.md") }
    val isChoosingDeletion = conflict.heads.any { it.revisionId == chosenId && it.deleted }
    Column(modifier.padding(horizontal = 19.dp, vertical = 10.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(9.dp)) {
            IconButton(onClick=onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack,"Notlara dön") }
            Text("REVİZYON ÇAKIŞMASI",fontWeight=FontWeight.Bold,fontSize=11.sp,letterSpacing=1.1.sp,color=MaterialTheme.colorScheme.primary)
        }
        Spacer(Modifier.height(6.dp))
        Text(if (conflict.pathCollision && conflict.heads.size == 1) "İki not aynı yolu kullanıyor." else "İki farklı sürüm korunuyor.",fontWeight=FontWeight.Bold,fontSize=19.sp)
        Text("Sürümü seç, gerekirse metni ve dosya yolunu düzenle, ardından yeni revizyon kaydet.",
            fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,lineHeight=18.sp)
        Spacer(Modifier.height(14.dp))
        if (conflict.pendingRevisionIds.isNotEmpty()) {
            EonCard(Modifier.fillMaxWidth()) { Text("Eksik ata revizyonları var. Diğer cihazla eşitleme tamamlanınca çözüm açılacak.",
                modifier=Modifier.padding(14.dp),fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant) }
            Spacer(Modifier.height(12.dp))
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).weight(1f, fill=false),
            verticalArrangement=Arrangement.spacedBy(10.dp)) {
            conflict.heads.forEachIndexed { index, head ->
                EonCard(Modifier.fillMaxWidth().clickable {
                    chosenId = head.revisionId;title=head.title;body=head.content;path=head.path ?: "Notes/${conflict.noteId}.md"
                }) {
                    Column(Modifier.padding(13.dp),verticalArrangement=Arrangement.spacedBy(5.dp)) {
                        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            Icon(if(chosenId==head.revisionId) Icons.Rounded.CheckCircle else Icons.Rounded.NoteAlt,
                                null,modifier=Modifier.size(18.dp),tint=if(chosenId==head.revisionId) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Sürüm ${index+1}${if(head.deleted) " · Silme" else ""}",fontSize=12.sp,fontWeight=FontWeight.Bold)
                            Spacer(Modifier.weight(1f))
                            Text(head.revisionId.take(10),fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(head.title,fontSize=12.sp,fontWeight=FontWeight.SemiBold)
                        Text(if(head.deleted) "Bu sürümde not silinmiş." else head.content.take(220).ifEmpty { "Boş içerik" },
                            fontSize=11.sp,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=5,overflow=TextOverflow.Ellipsis)
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(title,{title=it.take(256)},label={Text("Çözüm başlığı")},modifier=Modifier.fillMaxWidth(),singleLine=true,enabled=!isChoosingDeletion)
        Spacer(Modifier.height(9.dp))
        if (conflict.pathCollision) {
            OutlinedTextField(path,{ path=it.take(240) },label={Text("Benzersiz Markdown dosya yolu")},modifier=Modifier.fillMaxWidth(),singleLine=true,enabled=!isChoosingDeletion)
            Spacer(Modifier.height(9.dp))
        }
        OutlinedTextField(body,{body=it},label={Text("Birleştirilmiş Markdown")},modifier=Modifier.fillMaxWidth().weight(1f),enabled=!isChoosingDeletion)
        Spacer(Modifier.height(8.dp))
        if(!message.isNullOrBlank()) Text(message,color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=11.sp)
        Button(onClick={onResolve(chosenId,title,body,isChoosingDeletion,if(conflict.pathCollision) path else null)},enabled=conflict.pendingRevisionIds.isEmpty() && (conflict.heads.size>=2 || conflict.pathCollision),
            modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(11.dp)) {
            Icon(if(isChoosingDeletion) Icons.Rounded.DeleteOutline else Icons.Rounded.Save,null,Modifier.size(17.dp));Spacer(Modifier.width(8.dp));Text(if(isChoosingDeletion) "Silme kararını uygula" else "Çözümü güvenle kaydet")
        }
        Text("Önceki sürümler revizyon geçmişinde saklanır.",fontSize=10.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

