package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal data class EonAppearance(val id: String, val label: String, val accent: Color, val ground: Color)

internal val eonAppearances = listOf(
    EonAppearance("obsidian", "Obsidian", Color(0xFFDCE7EE), Color(0xFF0B1016)),
    EonAppearance("ocean", "Okyanus", Color(0xFFACDCFA), Color(0xFF080F18)),
    EonAppearance("violet", "Mor aurora", Color(0xFFD5C2FA), Color(0xFF100D19)),
    EonAppearance("rose", "Gün batımı", Color(0xFFF4C4D1), Color(0xFF170E14)),
    EonAppearance("light", "Aydınlık", Color(0xFF245E50), Color(0xFFF0F4F2)),
)

@Composable
internal fun EonAppearancePicker(selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Görünüm", style = MaterialTheme.typography.titleLarge)
        Text("Aynı akış, sana ait bir ton.", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyRow(Modifier.fillMaxWidth().selectableGroup(), contentPadding = PaddingValues(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(eonAppearances, key = { it.id }) { appearance ->
                val active = selected == appearance.id
                Column(Modifier.width(98.dp).heightIn(min = 116.dp).clip(eonPanelShape)
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .border(if (active) 1.5.dp else .75.dp,
                        if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                        eonPanelShape)
                    .selectable(active, enabled = enabled, role = Role.RadioButton, onClick = { onSelect(appearance.id) })
                    .padding(horizontal = 6.dp, vertical = 14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(46.dp).background(Brush.linearGradient(listOf(appearance.accent, appearance.ground)), CircleShape),
                        contentAlignment = Alignment.Center) {
                        if (active) Icon(Icons.Rounded.Check, null, tint = Color.White,
                            modifier = Modifier.size(24.dp).background(Color.Black.copy(alpha = .5f), CircleShape).padding(3.dp))
                    }
                    Text(appearance.label, style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
                }
            }
        }
    }
}
