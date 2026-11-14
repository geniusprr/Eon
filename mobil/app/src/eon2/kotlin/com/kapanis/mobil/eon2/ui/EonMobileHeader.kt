package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.kapanis.mobil.R
import com.kapanis.mobil.eon2.network.MobileUpdateState

@Composable
internal fun EonMobileHeader(
    connected: Boolean,
    paired: Boolean,
    transport: String?,
    update: MobileUpdateState,
    settingsOpen: Boolean,
    settingsEnabled: Boolean,
    onOpenUpdate: () -> Unit,
    onToggleSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val shape = MaterialTheme.shapes.medium
    val authenticated = connected && paired
    val connectionLabel = when {
        !connected -> "Yerel mod"
        !paired -> "Eşleştirme bekliyor"
        transport == "usb" -> "USB ile bağlı"
        transport == "tailscale" -> "Tailscale ile bağlı"
        else -> "PC bağlı"
    }
    val connectionColor = if (authenticated) colors.primary else colors.onSurfaceVariant

    Box(
        modifier.fillMaxWidth()
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .padding(horizontal = 24.dp, vertical = 6.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().eonGlass(prominent = true).padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.weight(1f).semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(40.dp).background(colors.primaryContainer, shape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painterResource(R.drawable.eon_launcher_foreground),
                        contentDescription = null,
                        tint = colors.onPrimaryContainer,
                        modifier = Modifier.size(40.dp),
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        "Eon", color = colors.onSurface,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(6.dp).background(connectionColor, CircleShape))
                        Text(connectionLabel, color = connectionColor, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }

            if (update.version != null) {
                val progress = update.progress.takeIf { update.phase == "downloading" }
                HeaderAction(
                    label = "Eon güncellemesi",
                    onClick = onOpenUpdate,
                    container = colors.primaryContainer,
                    state = progress?.let { "İndiriliyor, yüzde ${(it * 100).toInt()}" },
                ) {
                    if (progress != null) {
                        CircularProgressIndicator(
                            progress = { progress },
                            modifier = Modifier.size(30.dp).clearAndSetSemantics {},
                            color = colors.primary, trackColor = colors.outlineVariant, strokeWidth = 2.dp,
                        )
                    }
                    Icon(
                        Icons.Rounded.Download,
                        contentDescription = null,
                        tint = colors.onPrimaryContainer,
                        modifier = Modifier.size(if (progress == null) 22.dp else 16.dp),
                    )
                }
            }

            HeaderAction(
                label = if (settingsOpen) "Önceki sekmeye dön" else "Ayarlar",
                onClick = onToggleSettings,
                enabled = settingsEnabled,
                container = if (settingsOpen) colors.primaryContainer else colors.surfaceContainerHigh,
            ) {
                val tint = if (settingsOpen) colors.onPrimaryContainer else colors.onSurfaceVariant
                Icon(
                    if (settingsOpen) Icons.AutoMirrored.Rounded.ArrowBack else Icons.Rounded.Settings,
                    contentDescription = null,
                    tint = if (settingsEnabled) tint else tint.copy(alpha = .38f),
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

@Composable
private fun HeaderAction(
    label: String,
    onClick: () -> Unit,
    container: Color,
    enabled: Boolean = true,
    state: String? = null,
    content: @Composable () -> Unit,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(48.dp).semantics {
            contentDescription = label
            if (state != null) stateDescription = state
        },
    ) {
        Box(
            Modifier.size(40.dp).background(container, MaterialTheme.shapes.medium),
            contentAlignment = Alignment.Center,
        ) { content() }
    }
}

@Preview(name = "Mor aurora · USB", widthDp = 393, showBackground = true)
@Preview(name = "Aydınlık · büyük yazı", widthDp = 320, fontScale = 2f, showBackground = true)
@Composable
private fun EonMobileHeaderPreview() {
    val largeText = LocalDensity.current.fontScale > 1f
    EonTheme(if (largeText) "light" else "violet") {
        EonMobileHeader(
            connected = true, paired = !largeText, transport = "usb",
            update = if (largeText) MobileUpdateState(phase = "downloading", version = "2.0.0", progress = .42f)
                else MobileUpdateState(),
            settingsOpen = false, settingsEnabled = true, onOpenUpdate = {}, onToggleSettings = {},
        )
    }
}
