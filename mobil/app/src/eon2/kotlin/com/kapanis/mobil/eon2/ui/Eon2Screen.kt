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
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import android.content.res.Configuration
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
    Controls("Kontrol", Icons.Rounded.Bolt),
    Ai("Asistan", Icons.Rounded.AutoAwesome),
    LocalSend("Local Send", Icons.Rounded.SwapHoriz),
    Notes("Notlar", Icons.Rounded.NoteAlt),
    Settings("Ayarlar", Icons.Rounded.Settings),
}

private val portraitTabs = listOf(EonTab.Controls, EonTab.Ai, EonTab.LocalSend, EonTab.Notes)
private const val portraitSlotCount = 5
private const val rotationSlot = 2

private enum class ControlPage { Overview, Actions, Remote }

private val Green = Color(0xFF7BD2A4)

/** Avoid re-rendering the portrait UI for fresh JSONObject instances with unchanged connection data. */
private fun EonPeerStatus.samePresentationAs(other: EonPeerStatus, includeSystem: Boolean): Boolean =
    connected == other.connected && paired == other.paired && name == other.name &&
        transport == other.transport &&
        (!includeSystem || system?.toString() == other.system?.toString())

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
    val landscape by rememberUpdatedState(LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE)
    val store = remember { EonNotesRepository.shared(context.applicationContext) }
    val client = remember { EonUsbClient(context.applicationContext, store) }
    val aiChatState = remember { EonAiChatState() }
    val downloads = remember(client) { IncomingDownloads(context.applicationContext, client) }
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf(EonTab.Controls) }
    val receivedFiles by downloads.receivedFiles.collectAsStateWithLifecycle()
    val transferSnackbar = remember { SnackbarHostState() }
    var lastMainTab by rememberSaveable { mutableStateOf(EonTab.Controls) }
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
        withContext(Dispatchers.IO) { downloads.loadReceipts() }
        var lastError: String? = null
        while (isActive) {
            if (foreground && peer.connected && peer.paired && (Build.VERSION.SDK_INT >= 29 ||
                context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)) {
                val previousCount = downloads.receivedFiles.value.size
                try {
                    withContext(Dispatchers.IO) { downloads.receivePending() }
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
                val latest = downloads.receivedFiles.value
                val count = latest.size - previousCount
                if (count > 0 && tab != EonTab.LocalSend && !landscape) {
                    transferSnackbar.currentSnackbarData?.dismiss()
                    launch {
                        val label = if (count == 1) "Dosya alındı: ${latest.first().name}" else "$count dosya alındı"
                        if (transferSnackbar.showSnackbar(label, actionLabel = "Dosyalar") == SnackbarResult.ActionPerformed) {
                            selected = null
                            selectedConflict = null
                            createNew = false
                            tab = EonTab.LocalSend
                        }
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
                val detected = withContext(Dispatchers.IO) { client.detect() }
                if (!peer.samePresentationAs(detected, includeSystem = landscape)) {
                    peer = detected
                }
                if (detected.connected && detected.paired && !syncing) doSync()
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

    BackHandler(enabled = !landscape && (tab == EonTab.Settings || selected != null || createNew ||
        (tab == EonTab.Controls && controlPage != ControlPage.Overview))) {
        if (tab == EonTab.Settings) tab = lastMainTab
        else if (tab == EonTab.Controls && controlPage != ControlPage.Overview) controlPage = ControlPage.Overview
        else { selected = null; selectedConflict = null; createNew = false }
    }
    val pageStates = rememberSaveableStateHolder()
    if (tab == EonTab.Controls && controlPage == ControlPage.Remote) {
        PcRemoteScreen(client, peer, foreground,
            onBack = { controlPage = ControlPage.Overview },
            onRotate = { requestOrientation(if (landscape) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) })
        return
    }
    if (landscape) {
        pageStates.SaveableStateProvider("landscape") { LandscapeDeck(
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
        ) }
        return
    }
    val density = LocalDensity.current
    val systemBottom = WindowInsets.navigationBars.getBottom(density)
    val imeVisible = WindowInsets.ime.getBottom(density) > systemBottom
    val noteEditor = tab == EonTab.Notes && (selected != null || createNew)
    val navigationVisible = !noteEditor && !imeVisible
    var navigationHeight by remember { mutableStateOf(0) }
    val bottomClearance = with(density) {
        if (imeVisible) 0.dp
        else if (navigationVisible && navigationHeight > 0) navigationHeight.toDp()
        else systemBottom.toDp() + if (navigationVisible) 80.dp else 0.dp
    }
    Box(Modifier.fillMaxSize()) {
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        containerColor = Color.Transparent,
        topBar = {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
                    Image(painterResource(R.drawable.eon_launcher_foreground), "Eon logosu", modifier = Modifier.fillMaxSize())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(modifier = Modifier.eonGlass(RoundedCornerShape(20.dp)), color = Color.Transparent,
                        shape = RoundedCornerShape(20.dp)) {
                        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(7.dp).clip(CircleShape).background(if (peer.connected && peer.paired) Green else Color(0xFFCFA47D)))
                            Spacer(Modifier.width(6.dp))
                            Text(if (peer.connected && peer.paired) "Bağlı" else "Yerel", fontSize = 11.sp)
                        }
                    }
                    IconButton(onClick = {
                        if (tab == EonTab.Settings) tab = lastMainTab
                        else { lastMainTab = tab; tab = EonTab.Settings }
                    }, enabled = !noteEditor, modifier = Modifier.size(48.dp).semantics {
                        this.selected = tab == EonTab.Settings
                    }) {
                        Icon(Icons.Rounded.Settings, "Ayarlar", tint = if (tab == EonTab.Settings)
                            MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        },

    ) { padding ->
        val contentModifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding())
            .then(if (noteEditor) Modifier.navigationBarsPadding() else Modifier).imePadding()
        pageStates.SaveableStateProvider(tab) {
        when (tab) {
            EonTab.Ai -> EonAiScreen(client, peer.connected && peer.paired, aiChatState, scope,
                contentModifier, bottomClearance, onConnect = { tab = EonTab.Controls })
            EonTab.LocalSend -> PcControlsScreen(client, true, contentModifier, bottomClearance,
                receivedFiles = receivedFiles, onBack = { tab = EonTab.Controls })
            EonTab.Controls -> when (controlPage) {
                ControlPage.Remote -> Unit
                ControlPage.Actions -> PcControlsScreen(client, false, contentModifier, bottomClearance, onBack = { controlPage = ControlPage.Overview })
                ControlPage.Overview -> ControlsContent(contentModifier, client, peer, message, answering || outgoingToken != null, bottomClearance,
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
                    onOpenPcRemote = { controlPage = ControlPage.Remote })
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
            } else NotesContent(contentModifier, notes, bottomClearance, onNew={createNew=true;message=null}, onOpen={ note ->
                selected=note;message=null
                if (note.conflict) scope.launch {
                    try { selectedConflict = withContext(Dispatchers.IO) { store.conflict(note.id) } }
                    catch (error: Exception) { message = error.message ?: "Çakışma sürümleri yüklenemedi." }
                } else selectedConflict = null
            })
            EonTab.Settings -> Column(contentModifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp).padding(bottom = bottomClearance), verticalArrangement=Arrangement.spacedBy(16.dp)) {
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
    if (navigationVisible) {
        val shade = if (MaterialTheme.colorScheme.background.luminance() < .5f) Color.Black else Color.White
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(bottomClearance)
            .background(Brush.verticalGradient(0f to Color.Transparent, .65f to shade.copy(alpha = .65f), 1f to shade)))
        FloatingEonNavigation(tab, Modifier.align(Alignment.BottomCenter).onSizeChanged { navigationHeight = it.height },
            onRotate = { requestOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) }) { destination ->
            tab = destination
            controlPage = ControlPage.Overview
            selected = null
            selectedConflict = null
            createNew = false
        }
    }
    if (navigationVisible) {
        SnackbarHost(transferSnackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = bottomClearance))
    }
    }
}

@Composable
internal fun EonCard(modifier:Modifier=Modifier, content:@Composable ()->Unit) {
    Surface(modifier.eonGlass(), color=Color.Transparent, shape=RoundedCornerShape(24.dp)) { content() }
}

@Composable
internal fun EonRotationButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val colors = MaterialTheme.colorScheme
    Box(modifier.size(48.dp).clip(RoundedCornerShape(17.dp))
        .clickable(enabled = enabled, onClickLabel = label, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(39.dp).background(colors.primaryContainer, RoundedCornerShape(14.dp))
            .border(1.dp, colors.primary.copy(alpha = .55f), RoundedCornerShape(14.dp)))
        Image(painterResource(R.drawable.eon_launcher_foreground), null,
            modifier = Modifier.align(Alignment.Center).offset(x = (-3).dp, y = (-2).dp).size(34.dp))
        Box(Modifier.align(Alignment.BottomEnd).size(21.dp).background(colors.primary, CircleShape),
            contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.ScreenRotation, label, tint = colors.onPrimary, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun FloatingEonNavigation(selected: EonTab, modifier: Modifier, onRotate: () -> Unit, onSelect: (EonTab) -> Unit) {
    Box(modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center) {
        val barShape = RoundedCornerShape(32.dp)
        val indicatorShape = RoundedCornerShape(26.dp)
        Surface(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth().eonGlass(barShape, prominent = true),
            shape = barShape, color = Color.Transparent, contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            Box(Modifier.fillMaxWidth().padding(5.dp)) {
                val index = portraitTabs.indexOf(selected)
                if (index >= 0) {
                    val position by animateFloatAsState((index + if (index >= rotationSlot) 1 else 0).toFloat(),
                        animationSpec = tween(260, easing = FastOutSlowInEasing), label = "Sekme merceği")
                    BoxWithConstraints(Modifier.matchParentSize()) {
                        val slotWidth = maxWidth / portraitSlotCount
                        Box(Modifier.offset { IntOffset((slotWidth * position).roundToPx(), 0) }
                            .width(slotWidth).fillMaxHeight()
                            .background(MaterialTheme.colorScheme.primary.copy(alpha = .12f), indicatorShape)
                            .border(.75.dp, MaterialTheme.colorScheme.primary.copy(alpha = .22f), indicatorShape))
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).selectableGroup(),
                    verticalAlignment = Alignment.CenterVertically) {
                    for (slot in 0 until portraitSlotCount) {
                        if (slot == rotationSlot) {
                            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                                EonRotationButton("Deck'i yatay aç", onRotate)
                            }
                            continue
                        }
                        val destination = portraitTabs[slot - if (slot > rotationSlot) 1 else 0]
                        val isSelected = selected == destination
                        val tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                        Column(
                            modifier = Modifier.weight(1f).heightIn(min = 56.dp).clip(indicatorShape)
                                .selectable(selected = isSelected, role = Role.Tab, onClick = { if (!isSelected) onSelect(destination) })
                                .padding(horizontal = 2.dp, vertical = 6.dp),
                            verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(destination.icon, null, tint = tint, modifier = Modifier.size(21.dp))
                            Text(destination.label, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium, color = tint)
                        }
                    }
                }
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

