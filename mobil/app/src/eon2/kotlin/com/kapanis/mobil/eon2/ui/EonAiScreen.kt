package com.kapanis.mobil.eon2.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import com.kapanis.mobil.eon2.network.EonAiReply
import com.kapanis.mobil.eon2.network.EonPendingCommand
import com.kapanis.mobil.eon2.network.EonUsbClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

internal data class EonAiMessage(val fromUser: Boolean, val text: String, val actions: List<String> = emptyList())

/** Kept in Eon2Screen for tab navigation; deliberately never persisted to phone storage. */
internal class EonAiChatState {
    val messages = mutableStateListOf<EonAiMessage>()
    var draft by mutableStateOf("")
    var model by mutableStateOf("")
    var models by mutableStateOf<List<String>>(emptyList())
    var configured by mutableStateOf(false)
    var loading by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var pending by mutableStateOf<EonPendingCommand?>(null)
    var pendingLoading by mutableStateOf(false)
    var pendingBusy by mutableStateOf(false)
    var pendingError by mutableStateOf<String?>(null)
    var pendingNotice by mutableStateOf<String?>(null)
}

@Composable
internal fun EonAiScreen(
    client: EonUsbClient,
    paired: Boolean,
    state: EonAiChatState,
    scope: CoroutineScope,
    modifier: Modifier = Modifier,
    onConnect: () -> Unit,
) {
    val listState = rememberLazyListState()
    var modelsMenu by remember { mutableStateOf(false) }
    var modelQuery by remember { mutableStateOf("") }
    var reloadKey by remember { mutableStateOf(0) }
    // Keep the full catalogue searchable while creating at most 60 menu rows.
    val matchingModels = remember(state.models, modelQuery) {
        val query = modelQuery.trim()
        state.models.asSequence()
            .filter { query.isEmpty() || it.contains(query, ignoreCase = true) }
            .take(61).toList()
    }

    suspend fun refreshPending() {
        if (!paired) {
            state.pending = null
            state.pendingError = null
            return
        }
        state.pendingLoading = true
        try {
            state.pending = withContext(Dispatchers.IO) { client.aiPendingCommand() }
            state.pendingError = null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            state.pending = null
            state.pendingError = error.message ?: "Bekleyen kısayol okunamadı."
        } finally {
            state.pendingLoading = false
        }
    }

    LaunchedEffect(paired, reloadKey) {
        if (!paired) {
            state.configured = false
            state.models = emptyList()
            state.loading = false
            state.pending = null
            state.pendingError = null
            return@LaunchedEffect
        }
        state.loading = true
        state.error = null
        try {
            val (next, models) = withContext(Dispatchers.IO) {
                val status = client.aiState()
                val options = if (status.models.isEmpty()) client.aiModels() else status.models
                status to options
            }
            state.configured = next.configured
            state.models = models.distinct()
            if (state.model.isBlank() || (state.models.isNotEmpty() && state.model !in state.models)) {
                state.model = next.model.ifBlank { state.models.firstOrNull().orEmpty() }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            state.error = error.message ?: "AI ayarları alınamadı."
            state.configured = false
        } finally {
            state.loading = false
        }
        refreshPending()
    }

    fun decidePending(approve: Boolean) {
        val proposal = state.pending ?: return
        if (!paired || state.busy || state.pendingBusy || state.pendingLoading) return
        state.pendingBusy = true
        state.pendingError = null
        state.pendingNotice = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (approve) client.aiApproveCommand(proposal.id)
                    else client.aiRejectCommand(proposal.id)
                }
                if (state.pending?.id == proposal.id) state.pending = null
                state.pendingNotice = if (approve) "Komut kısayolu kaydedildi. Çalıştırılmadı."
                    else "Kısayol önerisi reddedildi."
                refreshPending()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                state.pendingError = error.message ?: "Kısayol kararı bilgisayara iletilemedi."
            } finally {
                state.pendingBusy = false
            }
        }
    }

    fun send() {
        val content = state.draft.trim()
        if (!paired || !state.configured || state.busy || state.pendingBusy || content.isEmpty()) return
        // Capture the conversation before appending this request. Trailing unanswered
        // messages may have failed and must not be sent as successful prior turns.
        val history = state.messages.toList().dropLastWhile { it.fromUser }.takeLast(10)
            .filter { it.text.isNotBlank() }
            .map { (if (it.fromUser) "user" else "assistant") to it.text.take(900) }
        state.draft = ""
        state.error = null
        state.messages.add(EonAiMessage(fromUser = true, text = content))
        state.busy = true
        scope.launch {
            try {
                val result: EonAiReply = withContext(Dispatchers.IO) {
                    client.aiSend(content, state.model.takeIf { it.isNotBlank() }, history)
                }
                state.messages.add(EonAiMessage(fromUser = false, text = result.reply, actions = result.actions))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                state.error = (error.message ?: "AI yanıtı alınamadı.") +
                    " Bilgisayarda bir işlem gerçekleşmiş olabileceğinden tekrar göndermeden önce kontrol et."
            } finally {
                try { refreshPending() } finally { state.busy = false }
            }
        }
    }

    LaunchedEffect(state.messages.size, state.busy) {
        val items = state.messages.size + (if (state.busy) 1 else 0)
        if (items > 0) listState.animateScrollToItem(items - 1)
    }

    Column(
        modifier.fillMaxSize().imePadding().padding(horizontal = 18.dp).padding(top = 12.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(16.dp)) {
                Icon(Icons.Rounded.AutoAwesome, contentDescription = null,
                    modifier = Modifier.padding(11.dp).size(22.dp), tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Eon Asistan", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleLarge)
                Text(if (paired) "Bilgisayarındaki Eon ile çalışır" else "Bilgisayar bağlantısı gerekli",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { reloadKey++ }, enabled = paired && !state.loading && !state.busy && !state.pendingBusy) {
                Icon(Icons.Rounded.Refresh, contentDescription = "AI ayarlarını yenile")
            }
        }

        if (paired && state.configured) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Model", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Box {
                    TextButton(onClick = {
                        modelQuery = ""
                        modelsMenu = true
                    }, enabled = state.models.isNotEmpty() && !state.busy) {
                        Text(state.model.ifBlank { "Varsayılan" }, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.width(212.dp))
                        Icon(Icons.Rounded.ArrowDropDown, contentDescription = null)
                    }
                    DropdownMenu(expanded = modelsMenu, onDismissRequest = { modelsMenu = false }) {
                        Text("Seçili: ${state.model.ifBlank { "Varsayılan" }}",
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                        OutlinedTextField(
                            value = modelQuery,
                            onValueChange = { modelQuery = it },
                            modifier = Modifier.width(300.dp).padding(horizontal = 10.dp, vertical = 4.dp),
                            label = { Text("Model ara") },
                            singleLine = true,
                        )
                        if (matchingModels.isEmpty()) {
                            Text("Eşleşen model yok.",
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                style = MaterialTheme.typography.bodySmall)
                        }
                        matchingModels.take(60).forEach { option ->
                            DropdownMenuItem(text = { Text(option, maxLines = 2) }, onClick = {
                                state.model = option
                                modelsMenu = false
                            })
                        }
                        if (matchingModels.size > 60) {
                            Text("İlk 60 eşleşme gösteriliyor. Aramayı daralt.",
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }

        if (!paired || (!state.configured && !state.loading)) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .65f),
                shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text(if (!paired) "Önce PC ile eşleştir" else "Masaüstünde AI kurulumu gerekli",
                        fontWeight = FontWeight.SemiBold)
                    Text(if (!paired) "Asistan, eşleştirilmiş bilgisayarındaki uygulamaları ve kısayolları yönetebilir."
                        else "OpenRouter anahtarını ve kullanılacak modeli bilgisayarındaki Eon ayarlarından yapılandır.",
                        style = MaterialTheme.typography.bodySmall)
                    if (!paired) Button(onClick = onConnect) { Text("Bağlantıyı aç") }
                }
            }
        }

        if (state.pendingLoading) {
            Text("Bekleyen komut kısayolu kontrol ediliyor…",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.pending?.let { proposal ->
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Text("Komut kısayolu onayı", style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold)
                    Text("AI bu kısayolu önerdi. Tam komutu incelemeden kaydetme. Kaydetmek komutu çalıştırmaz.",
                        style = MaterialTheme.typography.bodySmall)
                    Column(
                        Modifier.fillMaxWidth().heightIn(max = 180.dp).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Text("Ad", style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(proposal.name, style = MaterialTheme.typography.bodyMedium)
                        Text("Komut (tam içerik)", style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(proposal.command, style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace)
                    }
                    Text("Son geçerlilik: ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(proposal.expiresAt))}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { decidePending(false) },
                            enabled = paired && !state.busy && !state.pendingBusy && !state.pendingLoading,
                            modifier = Modifier.weight(1f)) { Text("Reddet") }
                        Button(onClick = { decidePending(true) },
                            enabled = paired && !state.busy && !state.pendingBusy && !state.pendingLoading,
                            modifier = Modifier.weight(1f)) {
                            Text(if (state.pendingBusy) "İşleniyor…" else "Kaydet")
                        }
                    }
                }
            }
        }
        state.pendingNotice?.let { notice ->
            Text(notice, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
        }
        state.pendingError?.let { error ->
            Text("Kısayol işlemi: $error", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }

        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(), state = listState,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.messages.isEmpty()) {
                item {
                    Column(Modifier.fillMaxWidth().padding(vertical = 28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Rounded.AutoAwesome, contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                        Text("Eon'a ne yapmasını istersin?", fontWeight = FontWeight.Medium)
                        Text("Uygulama, Deck ve kısayolların için komut yaz.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            itemsIndexed(state.messages) { _, message ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start) {
                    Surface(
                        color = if (message.fromUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth(.92f),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Text(if (message.fromUser) "Sen" else "Eon", fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                            Text(message.text, style = MaterialTheme.typography.bodyMedium)
                            if (message.actions.isNotEmpty()) {
                                Text("İşlemler", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                message.actions.forEach { action -> Text("• $action", style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                }
            }
            if (state.busy) item {
                Text("Eon yanıtlıyor…", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
            }
        }

        state.error?.let { error ->
            Text(error, color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = state.draft, onValueChange = { state.draft = it.take(4000) },
                modifier = Modifier.weight(1f).heightIn(min = 56.dp),
                placeholder = { Text("Eon'a bir komut yaz…") },
                maxLines = 4, enabled = paired && state.configured && !state.busy && !state.pendingBusy,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                shape = RoundedCornerShape(18.dp),
            )
            IconButton(onClick = { send() }, enabled = paired && state.configured && !state.busy && !state.pendingBusy && state.draft.isNotBlank()) {
                Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "Komutu gönder",
                    tint = if (paired && state.configured && !state.busy && !state.pendingBusy && state.draft.isNotBlank())
                        MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
