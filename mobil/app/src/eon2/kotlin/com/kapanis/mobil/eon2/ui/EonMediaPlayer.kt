package com.kapanis.mobil.eon2.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.VolumeDown
import androidx.compose.material.icons.automirrored.rounded.VolumeMute
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Local bounded artwork only. Decode away from composition and only when the cover changes. */
@Composable
internal fun EonMediaPlayer(media: JSONObject?, enabled: Boolean, detail: String,
    onMedia: (String, String) -> Unit, modifier: Modifier = Modifier, deck: Boolean = false) {
    val artwork = media?.optString("artwork").orEmpty()
    val bitmap by produceState<android.graphics.Bitmap?>(null, artwork) {
        value = null
        value = withContext(Dispatchers.IO) {
            if (artwork.length !in 24..174790 ||
                !artwork.startsWith("data:image/jpeg;base64,") && !artwork.startsWith("data:image/png;base64,")) null
            else try {
                val bytes = Base64.decode(artwork.substringAfter(','), Base64.NO_WRAP)
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth !in 1..1024 || bounds.outHeight !in 1..1024) null
                else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } catch (_: IllegalArgumentException) { null }
        }
    }
    val colors = remember(bitmap) {
        bitmap?.let { image ->
            // Average small regions, rather than single pixels that may be black or white borders.
            (0..1).map { region ->
                var red = 0; var green = 0; var blue = 0
                for (y in 1..4) for (x in 1..4) {
                    val pixel = image.getPixel(((region * 4 + x) * image.width / 10).coerceAtMost(image.width - 1),
                        (y * image.height / 5).coerceAtMost(image.height - 1))
                    red += android.graphics.Color.red(pixel)
                    green += android.graphics.Color.green(pixel)
                    blue += android.graphics.Color.blue(pixel)
                }
                Color(red / 16, green / 16, blue / 16)
            }
        }
    }
    val playing = media?.optBoolean("playing") == true
    val title = media?.optString("title").orEmpty().ifBlank { "Müziğine yer aç" }
    val artist = media?.optString("artist").orEmpty().ifBlank { detail }
    val status = if (media == null) "PC medyası" else if (playing) "Şimdi çalıyor" else "Duraklatıldı"
    val scheme = MaterialTheme.colorScheme
    var showVolume by rememberSaveable { mutableStateOf(false) }
    Surface(if (deck) modifier.deckGlass(accent = scheme.tertiary) else modifier.eonGlass(),
        shape = eonPanelShape, color = Color.Transparent) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val fontScale = LocalDensity.current.fontScale.coerceAtLeast(1f)
            val compact = maxHeight < 208.dp * fontScale || maxWidth < 220.dp
            val wide = maxWidth >= 440.dp && maxHeight >= 180.dp * fontScale
            val coverSize = when {
                wide -> minOf(maxHeight - 32.dp, 184.dp)
                compact -> 48.dp
                else -> minOf(maxHeight - 96.dp, maxWidth * .40f, 120.dp).coerceAtLeast(56.dp)
            }
            val spacing = 8.dp
            val inset = if (compact) 8.dp else 10.dp
            colors?.let { tones ->
                Canvas(Modifier.fillMaxSize()) {
                    drawRect(Brush.radialGradient(listOf(tones[0].copy(alpha = .48f), Color.Transparent),
                        center = Offset(size.width * .05f, 0f), radius = size.maxDimension * .95f))
                    drawRect(Brush.radialGradient(listOf(tones[1].copy(alpha = .28f), Color.Transparent),
                        center = Offset(size.width, size.height), radius = size.maxDimension * .85f))
                }
            }
            if (wide) {
                Row(Modifier.fillMaxSize().padding(inset), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    PlayerCover(bitmap, title, Modifier.size(coverSize))
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            PlayerMetadata(title, artist, status, compact = false, Modifier.weight(1f))
                            PlayerVolumeTrigger(enabled, { showVolume = true })
                        }
                        PlayerTransport(playing, enabled, onMedia, compact = false, Modifier.fillMaxWidth())
                    }
                }
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(inset),
                    verticalArrangement = Arrangement.spacedBy(spacing, Alignment.CenterVertically)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(spacing)) {
                        PlayerCover(bitmap, title, Modifier.size(coverSize))
                        Column(Modifier.weight(1f)) {
                            PlayerMetadata(title, artist, status, compact, Modifier.fillMaxWidth(),
                                volume = if (compact) null else { { PlayerVolumeTrigger(enabled, { showVolume = true }) } })
                        }
                        if (compact) PlayerVolumeTrigger(enabled, { showVolume = true })
                    }
                    PlayerTransport(playing, enabled, onMedia, compact, Modifier.fillMaxWidth())
                }
            }
        }
    }
    if (showVolume) PlayerVolumeSheet(enabled, onMedia, onDismiss = { showVolume = false })
}

@Composable
private fun PlayerCover(bitmap: android.graphics.Bitmap?, title: String, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(scheme.surfaceVariant)
        .border(1.dp, scheme.onSurface.copy(alpha = .08f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap.asImageBitmap(), "$title kapağı", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(Icons.Rounded.MusicNote, null, Modifier.fillMaxSize(.4f), tint = scheme.onSurfaceVariant)
    }
}

@Composable
private fun PlayerMetadata(title: String, artist: String, status: String, compact: Boolean, modifier: Modifier = Modifier,
    volume: (@Composable () -> Unit)? = null) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(if (compact) 2.dp else 4.dp)) {
        if (!compact) Text(status, color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(title, style = if (compact) MaterialTheme.typography.titleSmall else MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold, maxLines = if (compact) 1 else 2, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(artist, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            volume?.invoke()
        }
    }
}

@Composable
private fun PlayerVolumeTrigger(enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    IconButton(onClick = onClick, enabled = enabled, modifier = modifier.size(48.dp)) {
        Icon(Icons.AutoMirrored.Rounded.VolumeUp, "Ses kontrolleri", Modifier.size(20.dp))
    }
}

@Composable
private fun PlayerTransport(playing: Boolean, enabled: Boolean, onMedia: (String, String) -> Unit,
    compact: Boolean, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
        PlayerKey("previous", "Önceki parça", Icons.Rounded.SkipPrevious, enabled, onMedia)
        FilledIconButton(enabled = enabled, onClick = { onMedia("playPause", if (playing) "Duraklat" else "Oynat") },
            modifier = Modifier.size(if (compact) 56.dp else 60.dp), shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.onSurface,
                contentColor = MaterialTheme.colorScheme.surface)) {
            Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                if (playing) "Duraklat" else "Oynat", Modifier.size(30.dp))
        }
        PlayerKey("next", "Sonraki parça", Icons.Rounded.SkipNext, enabled, onMedia)
    }
}

@Composable
private fun PlayerKey(id: String, label: String, icon: ImageVector, enabled: Boolean,
    onMedia: (String, String) -> Unit, modifier: Modifier = Modifier) {
    IconButton(enabled = enabled, onClick = { onMedia(id, label) }, modifier = modifier.size(48.dp)) {
        Icon(icon, label, Modifier.size(24.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlayerVolumeSheet(enabled: Boolean, onMedia: (String, String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss,
        shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding()
            .padding(horizontal = 24.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Bilgisayar sesi", style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() })
            Text("Windows’un genel sesini kontrol eder.", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                listOf(Triple("volumeDown", "Sesi azalt", Icons.AutoMirrored.Rounded.VolumeDown),
                    Triple("mute", "Kapat / aç", Icons.AutoMirrored.Rounded.VolumeMute),
                    Triple("volumeUp", "Sesi artır", Icons.AutoMirrored.Rounded.VolumeUp)).forEach { (id, label, icon) ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        PlayerKey(id, label, icon, enabled, onMedia)
                        Text(label, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Preview(name = "Deck phone", widthDp = 272, heightDp = 214, showBackground = true)
@Preview(name = "Small card", widthDp = 184, heightDp = 140, showBackground = true)
@Preview(name = "Wide card", widthDp = 520, heightDp = 240, showBackground = true)
@Preview(name = "Large text", widthDp = 272, heightDp = 214, fontScale = 2f, showBackground = true)
@Composable
private fun MediaPlayerPreview() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        EonMediaPlayer(JSONObject().put("title", "Ah Bir Ataş Ver").put("artist", "Fatma Turgut").put("playing", true),
            enabled = true, detail = "Windows medyası", onMedia = { _, _ -> }, modifier = Modifier.fillMaxSize())
    }
}
