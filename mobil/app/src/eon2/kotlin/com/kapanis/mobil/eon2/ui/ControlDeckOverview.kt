package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kapanis.mobil.eon2.network.EonPeerStatus
import com.kapanis.mobil.eon2.network.EonUsbClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private val Green = Color(0xFF7BD2A4)
@Composable
internal fun ControlsContent(modifier:Modifier,client:EonUsbClient,peer:EonPeerStatus,message:String?,busy:Boolean,
    onPair:()->Unit,
    onOpenPcActions:()->Unit,onOpenFiles:()->Unit) {
    val scope = rememberCoroutineScope()
    val active = peer.connected && peer.paired
    var deck by remember(active, peer.name) { mutableStateOf<JSONObject?>(null) }
    var loading by remember(active, peer.name) { mutableStateOf(active) }
    var loadError by remember(active, peer.name) { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var toConfirm by remember { mutableStateOf<PortraitDeckAction?>(null) }
    val quickActions = remember(deck) { portraitDeckActions(deck) }
    val shortcutsAllowed = deck?.optBoolean("shortcutsAllowed") == true
    val mediaAvailable = deck?.optBoolean("mediaAvailable") == true && shortcutsAllowed && active
    val media = deck?.optJSONObject("media")

    LaunchedEffect(active, peer.name) {
        if (!active) return@LaunchedEffect
        while (isActive) {
            try {
                deck = withContext(Dispatchers.IO) { client.deck() }
                loadError = null
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { loadError = error.message ?: "Panel verileri alınamadı." }
            loading = false
            delay(4500)
        }
    }

    fun sendAction(action: PortraitDeckAction) {
        if (sending) return
        if (!active) { feedback = "Önce bilgisayara bağlan."; return }
        if (!action.approved) { feedback = "Bu kısayolu PC’den telefon erişimine aç."; return }
        if (!action.available) { feedback = "PC’den Kısayollar veya Güç iznini aç."; return }
        sending = true
        feedback = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (action.tool) client.executeDeckCommand(action.id)
                    else client.executeAction(action.id, action.kind)
                }
                feedback = action.name + " · Komut gönderildi."
                deck = withContext(Dispatchers.IO) { client.deck() }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { feedback = error.message ?: "Komut çalıştırılamadı." }
            finally { sending = false }
        }
    }

    fun mediaCommand(id: String) {
        if (!mediaAvailable || sending) return
        sending = true
        feedback = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { client.executeDeckCommand(id) }
                feedback = "Medya komutu gönderildi."
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { feedback = error.message ?: "Medya kontrol edilemedi." }
            finally { sending = false }
        }
    }

    Column(modifier.verticalScroll(rememberScrollState()).padding(horizontal=24.dp,vertical=20.dp),
        verticalArrangement=Arrangement.spacedBy(17.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Kontrol merkezi", style=MaterialTheme.typography.headlineLarge)
                Text("Bilgisayarın, tek dokunuş uzağında.", style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Surface(shape=RoundedCornerShape(14.dp), color=MaterialTheme.colorScheme.primaryContainer) {
                Icon(Icons.Rounded.Tune, null, Modifier.padding(13.dp).size(23.dp),
                    tint=MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }

        Surface(Modifier.fillMaxWidth().eonGlass(), shape=RoundedCornerShape(24.dp), color=Color.Transparent) {
            Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Surface(shape=RoundedCornerShape(15.dp), color=MaterialTheme.colorScheme.primaryContainer) {
                        Icon(Icons.Rounded.Computer, null, Modifier.padding(12.dp).size(25.dp),
                            tint=MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(peer.name, fontWeight=FontWeight.Bold, fontSize=15.sp,
                            maxLines=1, overflow=TextOverflow.Ellipsis)
                        Text(when {
                            active -> if (peer.transport=="tailscale") "Tailscale HTTPS · Kimlik doğrulandı" else "USB · Kimlik doğrulandı"
                            peer.connected -> "Bilgisayar bulundu · Eşleştirme bekliyor"
                            else -> "Çevrimdışı · Bağlantı bekleniyor"
                        }, fontSize=11.sp, color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Surface(color=(if (active) Green else MaterialTheme.colorScheme.outline).copy(alpha=.16f),
                        shape=RoundedCornerShape(20.dp)) {
                        Icon(if (active) Icons.Rounded.CheckCircle else Icons.Rounded.WifiOff,
                            if (active) "Bağlı" else "Bağlı değil", Modifier.padding(10.dp).size(20.dp),
                            tint=if (active) Green else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (!active) {
                    HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.25f))
                    Text(if (peer.connected) "Telefonu bu bilgisayarla eşleştirerek kontrollere erişebilirsin."
                        else "USB veri kablosuyla bağlan veya daha önce eşleştirdiğin Tailscale bağlantısını aç.",
                        style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.onSurfaceVariant)
                    if (peer.connected && !peer.paired && peer.transport=="usb") {
                        Button(onClick=onPair, enabled=!busy, modifier=Modifier.fillMaxWidth()) {
                            Text(if (busy) "Onay bekleniyor…" else "Bilgisayarla eşleştir")
                        }
                    }
                } else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                        PortraitSystemMetric("İşlemci", peer.system?.optJSONObject("cpu"), Icons.Rounded.Memory, Modifier.weight(1f))
                        PortraitSystemMetric("Bellek", peer.system?.optJSONObject("memory"), Icons.Rounded.Storage, Modifier.weight(1f))
                    }
                }
            }
        }

        val status = feedback ?: message ?: loadError
        status?.let {
            Surface(Modifier.fillMaxWidth().semantics { liveRegion=LiveRegionMode.Polite },
                color=MaterialTheme.colorScheme.secondaryContainer, shape=RoundedCornerShape(13.dp)) {
                Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Info, null, Modifier.size(18.dp), tint=MaterialTheme.colorScheme.onSecondaryContainer)
                    Spacer(Modifier.width(9.dp))
                    Text(it, style=MaterialTheme.typography.bodySmall,
                        color=MaterialTheme.colorScheme.onSecondaryContainer, modifier=Modifier.weight(1f))
                }
            }
        }
        if (sending) LinearProgressIndicator(Modifier.fillMaxWidth())

        Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Hızlı komutlar", style=MaterialTheme.typography.titleMedium, fontWeight=FontWeight.Bold)
                Text("İzin verdiğin PC işlemleri", color=MaterialTheme.colorScheme.onSurfaceVariant,
                    style=MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick=onOpenPcActions, enabled=active) {
                Text("Tümünü gör")
                Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(18.dp))
            }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (active && !loading && quickActions.isEmpty()) {
            EonCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Text(if (loadError != null) "Kısayollar yüklenemedi" else "Henüz kısayol bulunamadı",
                        fontWeight=FontWeight.SemiBold)
                    Text(if (loadError != null) "Bağlantıyı kontrol et ve tekrar dene."
                        else "Bilgisayarında PC Kısayolları bölümünden kendi eylemlerini ekle.",
                        style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick=onOpenPcActions) { Text("Kısayolları yönet") }
                }
            }
        }
        if (quickActions.isNotEmpty()) {
            quickActions.take(4).chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    pair.forEach { action ->
                        PortraitDeckTile(action, sending, Modifier.weight(1f)) {
                            if (action.kind in listOf("command", "lock", "shutdown", "restart", "cancel"))
                                toConfirm = action
                            else sendAction(action)
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }

        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            Text("Medya", style=MaterialTheme.typography.titleMedium,
                fontWeight=FontWeight.Bold, modifier=Modifier.weight(1f))
            Text("WINDOWS SESSION", fontSize=10.sp, letterSpacing=1.sp,
                color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        EonMediaPlayer(media = media, enabled = mediaAvailable && !sending,
            detail = when {
                !active -> "PC bağlantısı bekleniyor"
                !shortcutsAllowed -> "PC'de Kısayollar iznini aç"
                else -> "Bir müzik uygulamasında parça aç"
            }, onMedia = { id, _ -> mediaCommand(id) },
            modifier = Modifier.fillMaxWidth().height(240.dp))
        Text("ÇALIŞMA ALANI", fontSize=10.sp, letterSpacing=1.3.sp,
            color=MaterialTheme.colorScheme.onSurfaceVariant, fontWeight=FontWeight.Bold)
        PortraitControlRoute(Icons.Rounded.Apps, "PC kısayolları",
            "Uygulamalar, komutlar ve güç işlemleri", active, onOpenPcActions)
        PortraitControlRoute(Icons.Rounded.SwapHoriz, "Dosya aktarımı",
            "USB ve Tailscale üzerinden güvenli dosyalar", active, onOpenFiles)
        Text("Telefon yatay konumdayken tam ekran Control Deck açılır.",
            style=MaterialTheme.typography.labelSmall, color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    toConfirm?.let { action ->
        AlertDialog(onDismissRequest={toConfirm=null}, title={Text(action.name)},
            text={Text("Bu işlem bilgisayarında çalıştırılacak. Devam etmek istiyor musun?")},
            confirmButton={TextButton(enabled=!sending, onClick={toConfirm=null;sendAction(action)}) {Text("Çalıştır")}},
            dismissButton={TextButton(onClick={toConfirm=null}){Text("Vazgeç")}})
    }
}

private data class PortraitDeckAction(
    val id:String,val name:String,val kind:String,val tool:Boolean,
    val available:Boolean,val approved:Boolean
)

private fun portraitDeckActions(deck: JSONObject?): List<PortraitDeckAction> {
    if (deck == null) return emptyList()
    val result = mutableListOf<PortraitDeckAction>()
    val allowed = deck.optBoolean("shortcutsAllowed")
    deck.optJSONArray("tools")?.let { array ->
        for (i in 0 until array.length()) {
            val value = array.optJSONObject(i) ?: continue
            result.add(PortraitDeckAction(value.optString("id"),value.optString("name"),
                value.optString("icon"),true,allowed,true))
        }
    }
    deck.optJSONArray("actions")?.let { array ->
        for (i in 0 until array.length()) {
            val value = array.optJSONObject(i) ?: continue
            result.add(PortraitDeckAction(value.optString("id"),value.optString("name"),
                value.optString("kind"),false,value.optBoolean("available"),value.optBoolean("remoteEnabled")))
        }
    }
    return result.filter { it.id.isNotBlank() && it.name.isNotBlank() }
}

private fun portraitActionIcon(kind:String): ImageVector = when(kind) {
    "folder","file" -> Icons.Rounded.FolderOpen
    "terminal","command" -> Icons.Rounded.Terminal
    "chart" -> Icons.Rounded.BarChart
    "settings" -> Icons.Rounded.Settings
    "lock" -> Icons.Rounded.Lock
    "shutdown" -> Icons.Rounded.PowerSettingsNew
    "restart" -> Icons.Rounded.RestartAlt
    "cancel" -> Icons.Rounded.TimerOff
    else -> Icons.Rounded.Apps
}

@Composable
private fun PortraitSystemMetric(label:String, value:JSONObject?, icon:ImageVector, modifier:Modifier) {
    val number = value?.optDouble("usagePercent",Double.NaN)?.takeIf { it.isFinite() && it in 0.0..100.0 }
    Surface(modifier, shape=RoundedCornerShape(13.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.48f)) {
        Column(Modifier.padding(12.dp), verticalArrangement=Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Icon(icon,null,Modifier.size(16.dp),tint=MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(6.dp))
                Text(label,style=MaterialTheme.typography.labelMedium,
                    color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.weight(1f))
                Text(number?.let { it.toInt().toString()+"%" } ?: "—",fontWeight=FontWeight.Bold)
            }
            LinearProgressIndicator(progress={((number?:0.0)/100.0).toFloat()},
                modifier=Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(8.dp)))
        }
    }
}

@Composable
private fun PortraitDeckTile(action:PortraitDeckAction, sending:Boolean, modifier:Modifier, onClick:()->Unit) {
    val accent = MaterialTheme.colorScheme.primary
    Surface(onClick=onClick, enabled=!sending, modifier=modifier.height(90.dp).eonGlass(),
        shape=RoundedCornerShape(24.dp),color=Color.Transparent) {
        Column(Modifier.fillMaxSize().padding(12.dp),verticalArrangement=Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Icon(portraitActionIcon(action.kind),null,Modifier.size(22.dp),
                    tint=if(action.available && action.approved) accent else MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.weight(1f))
                if(!action.available || !action.approved)
                    Icon(Icons.Rounded.Lock,"PC izni gerekli",Modifier.size(15.dp),
                        tint=MaterialTheme.colorScheme.onSurfaceVariant)
                else Icon(Icons.Rounded.NorthEast,null,Modifier.size(15.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(action.name,maxLines=2,overflow=TextOverflow.Ellipsis,
                style=MaterialTheme.typography.labelLarge,fontWeight=FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PortraitControlRoute(icon:ImageVector,title:String,detail:String,enabled:Boolean,onClick:()->Unit) {
    Surface(onClick=onClick,enabled=enabled,modifier=Modifier.fillMaxWidth().eonGlass(),
        shape=RoundedCornerShape(24.dp),color=Color.Transparent) {
        Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically,
            horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Surface(color=MaterialTheme.colorScheme.surfaceVariant,shape=RoundedCornerShape(11.dp)) {
                Icon(icon,null,Modifier.padding(10.dp).size(22.dp),tint=MaterialTheme.colorScheme.primary)
            }
            Column(Modifier.weight(1f)) {
                Text(title,fontWeight=FontWeight.SemiBold)
                Text(detail,style=MaterialTheme.typography.bodySmall,
                    color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2)
            }
            Icon(if(enabled) Icons.AutoMirrored.Rounded.ArrowForward else Icons.Rounded.Lock,
                null,Modifier.size(18.dp),tint=MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

