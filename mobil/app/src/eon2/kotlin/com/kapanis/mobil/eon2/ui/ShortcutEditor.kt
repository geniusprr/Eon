package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

private val shortcutKinds = listOf("application", "file", "command", "lock", "shutdown", "restart", "cancel")

internal fun shortcutKindLabel(kind: String): String = when (kind) {
    "application" -> "Uygulama aç"
    "file" -> "Dosya aç"
    "command" -> "PowerShell komutu"
    "lock" -> "Oturumu kilitle"
    "shutdown" -> "Bilgisayarı kapat"
    "restart" -> "Yeniden başlat"
    "cancel" -> "Güç planını iptal et"
    else -> "PC kısayolu"
}

internal data class ShortcutDraft(
    val id: String = UUID.randomUUID().toString(),
    val existing: Boolean = false,
    val name: String = "",
    val kind: String = "application",
    val target: String = "",
    val argumentsText: String = "[]",
    val delayText: String = "60",
    val icon: String = "",
) {
    companion object {
        fun read(json: JSONObject) = ShortcutDraft(
            id = json.getString("id"), existing = true, name = json.getString("name"),
            kind = json.getString("kind"), target = json.optString("target"),
            argumentsText = (json.optJSONArray("arguments") ?: JSONArray()).toString(),
            delayText = json.optLong("delaySeconds").toString(), icon = json.optString("icon", ""),
        )
    }

    fun toPayload(): JSONObject {
        val trimmedName = name.trim()
        require(trimmedName.isNotEmpty() && trimmedName.length <= 80) { "Kısayol adı 1–80 karakter olmalı." }
        val path = if (kind in listOf("application", "file", "command")) target.trim() else ""
        require(path.length <= 4096 && '\u0000' !in path) { "Komut veya yol geçersiz." }
        val absoluteDrive = Regex("^[A-Za-z]:[\\\\/]").containsMatchIn(path)
        val windowsLink = path.endsWith(".lnk", ignoreCase = true)
        when (kind) {
            "application" -> require(
                (absoluteDrive || path.startsWith('\\') || path.startsWith('/')) &&
                    (windowsLink || path.endsWith(".exe", ignoreCase = true)),
            ) { "Uygulamanın tam Windows yolunu (.exe veya .lnk) gir." }
            "file" -> require(absoluteDrive) { "Dosyanın tam Windows yolunu gir." }
            "command" -> require(path.isNotEmpty()) { "Bir PowerShell komutu gir." }
        }
        val arguments = if (kind == "application" && !windowsLink) {
            val parsed = try {
                JSONArray(argumentsText)
            } catch (_: org.json.JSONException) {
                throw IllegalArgumentException("Argümanları JSON metin dizisi olarak gir.")
            }
            require(parsed.length() <= 32 && (0 until parsed.length()).all { index ->
                val value = parsed.opt(index)
                value is String && value.length <= 2048 && '\u0000' !in value
            }) { "En fazla 32 kısa metin argümanı gir." }
            parsed
        } else JSONArray()
        val delay = if (kind == "shutdown" || kind == "restart") {
            val value = delayText.toLongOrNull()
            require(value != null && value in 0..604800) { "Gecikme 0 ile 604800 saniye arasında olmalı." }
            value
        } else 0L
        return JSONObject().put("id", id).put("name", trimmedName).put("kind", kind).put("target", path)
            .put("arguments", arguments).put("delaySeconds", delay)
            .apply { if (icon.isNotBlank()) put("icon", icon) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShortcutEditor(
    draft: ShortcutDraft,
    saving: Boolean,
    canEdit: Boolean,
    error: String?,
    onChange: (ShortcutDraft) -> Unit,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val enabled = canEdit && !saving
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (draft.existing) "Kısayolu düzenle" else "Yeni kısayol") },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(
                    value = draft.name, onValueChange = { onChange(draft.copy(name = it.take(80))) },
                    label = { Text("Kısayol adı") }, enabled = enabled, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                ExposedDropdownMenuBox(expanded = expanded && enabled, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value = shortcutKindLabel(draft.kind), onValueChange = {}, readOnly = true,
                        enabled = enabled, label = { Text("İşlem türü") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded && enabled) },
                        modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled).fillMaxWidth(),
                    )
                    ExposedDropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
                        shortcutKinds.forEach { kind ->
                            DropdownMenuItem(text = { Text(shortcutKindLabel(kind)) }, onClick = {
                                expanded = false
                                if (kind != draft.kind) onChange(draft.copy(kind = kind, target = "", argumentsText = "[]"))
                            })
                        }
                    }
                }
                val targetLabel = when (draft.kind) {
                    "application" -> "Windows yolu (.exe veya .lnk)"
                    "file" -> "Windows dosya yolu"
                    "command" -> "PowerShell komutu"
                    else -> null
                }
                if (targetLabel != null) OutlinedTextField(
                    value = draft.target, onValueChange = { onChange(draft.copy(target = it.take(4096))) },
                    label = { Text(targetLabel) }, enabled = enabled, modifier = Modifier.fillMaxWidth(),
                    minLines = 2, maxLines = 4,
                )
                if (draft.kind == "application" && !draft.target.trim().endsWith(".lnk", true)) {
                    OutlinedTextField(
                        value = draft.argumentsText, onValueChange = { onChange(draft.copy(argumentsText = it.take(65536))) },
                        label = { Text("Argümanlar (JSON)") }, supportingText = { Text("Örnek: [\"--help\"]") },
                        enabled = enabled, modifier = Modifier.fillMaxWidth(), maxLines = 3,
                    )
                }
                if (draft.kind == "shutdown" || draft.kind == "restart") OutlinedTextField(
                    value = draft.delayText,
                    onValueChange = { onChange(draft.copy(delayText = it.filter(Char::isDigit).take(6))) },
                    label = { Text("Gecikme (saniye)") }, supportingText = { Text("0 girersen işlem onaydan sonra başlar.") },
                    enabled = enabled, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                if (!draft.existing) Text("Telefon erişimi açık olarak kaydedilir.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val message = error ?: if (!canEdit) "Kaydetmek için PC bağlantısı ve Kısayollar izni gerekli." else null
                if (message != null) Text(message, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(onClick = onSave, enabled = enabled && draft.name.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (saving) "Kaydediliyor…" else "Kaydet")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("Vazgeç")
            }
        },
    )
}
