package com.kapanis.mobil.eon2.ui

import android.content.Context
import android.util.AtomicFile
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.NoteAdd
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kapanis.mobil.eon2.data.EonLocalNote
import com.kapanis.mobil.eon2.data.EonNotesRepository
import com.kapanis.mobil.eon2.protocol.CanonicalNotes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.text.DateFormat
import java.util.Date

// Local atomic drafts remain separate from authoritative synchronized revisions.
class NoteDrafts(context: Context) {
    private val directory = File(context.filesDir, "note-drafts")
    private fun file(id: String?) = AtomicFile(File(directory, "${id?.let(CanonicalNotes::sha256) ?: "new"}.json"))
    fun read(id: String?): JSONObject? = synchronized(lock) {
        val source = file(id)
        if (!source.baseFile.exists()) null else JSONObject(source.openRead().bufferedReader().use { it.readText() })
    }
    fun write(id: String?, title: String, body: String, revision: String?) = synchronized(lock) {
        check(directory.isDirectory || directory.mkdirs()) { "Taslak klasörü açılamadı." }
        val target = file(id)
        val output = target.startWrite()
        try {
            output.write(JSONObject().put("title", title).put("body", body)
                .put("revision", revision ?: JSONObject.NULL).toString().toByteArray(Charsets.UTF_8))
            target.finishWrite(output)
        } catch (error: Exception) {
            target.failWrite(output)
            throw error
        }
    }
    fun remove(id: String?) = synchronized(lock) { file(id).delete() }
    companion object { private val lock = Any() }
}

private fun loadNotePaths(context: Context, notes: List<EonLocalNote>): Map<String, String> {
    if (notes.isEmpty()) return emptyMap()
    val revisions = notes.associateBy { it.revisionId }
    val paths = mutableMapOf<String, String>()
    EonNotesRepository(context).use { repository ->
        repository.readableDatabase.rawQuery("SELECT revision_id,payload FROM operations", null).use { cursor ->
            while (cursor.moveToNext()) {
                val note = revisions[cursor.getString(0)] ?: continue
                val metadata = JSONObject(cursor.getString(1)).getJSONObject("revision")
                    .optJSONObject("metadata") ?: continue
                val path = metadata.optString("path")
                if (CanonicalNotes.isSafeRelativeNotePath(path)) paths[note.id] = path.replace('\\', '/')
            }
        }
    }
    return paths
}
private fun pathOf(note: EonLocalNote, paths: Map<String, String>) =
    paths[note.id] ?: "Notes/${note.id}.md"
private fun folderOf(note: EonLocalNote, paths: Map<String, String>) =
    pathOf(note, paths).substringBeforeLast('/', "")
private fun folderCounts(notes: List<EonLocalNote>, paths: Map<String, String>): Map<String, Int> {
    val counts = mutableMapOf<String, Int>()
    notes.forEach { note ->
        val segments = folderOf(note, paths).split('/').filter { it.isNotEmpty() }
        val folders = if (segments.isEmpty()) listOf("")
            else segments.indices.map { segments.take(it + 1).joinToString("/") }
        folders.forEach { folder -> counts[folder] = (counts[folder] ?: 0) + 1 }
    }
    return counts
}
private data class NoteFolders(val counts: Map<String, Int>, val folders: List<String>)

// A notes refresh may rebuild megabytes of identical text. Comparing the list as a
// Compose remember key would compare every note body on the UI thread.
private class NoteListIdentity(private val notes: List<EonLocalNote>) {
    override fun equals(other: Any?): Boolean = other is NoteListIdentity && notes === other.notes
    override fun hashCode(): Int = System.identityHashCode(notes)
}

/** Count whitespace-delimited words without building a temporary list for every token. */
internal fun countNoteWords(text: String): Int {
    var words = 0
    var inWord = false
    text.forEach { char ->
        if (char.isWhitespace()) inWord = false
        else if (!inWord) {
            words++
            inWord = true
        }
    }
    return words
}

private fun matchesFolder(note: EonLocalNote, paths: Map<String, String>, folder: String): Boolean {
    val path = folderOf(note, paths)
    return path == folder || (folder.isNotEmpty() && path.startsWith("$folder/"))
}

@Composable
fun NotesContent(modifier: Modifier, notes: List<EonLocalNote>,
                 onNew: () -> Unit, onOpen: (EonLocalNote) -> Unit) {
    val context = LocalContext.current.applicationContext
    var query by rememberSaveable { mutableStateOf("") }
    var folder by rememberSaveable { mutableStateOf<String?>(null) }
    var onlyConflicts by rememberSaveable { mutableStateOf(false) }
    var alphaSort by rememberSaveable { mutableStateOf(false) }
    var foldersVisible by rememberSaveable { mutableStateOf(false) }
    var collapsed by remember { mutableStateOf(setOf<String>()) }
    var paths by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var pathsFailed by remember { mutableStateOf(false) }
    val revisionKeys = remember(NoteListIdentity(notes)) { notes.map { it.id to it.revisionId } }
    LaunchedEffect(revisionKeys) {
        try {
            paths = withContext(Dispatchers.IO) { loadNotePaths(context, notes) }
            pathsFailed = false
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            paths = emptyMap()
            pathsFailed = true
        }
    }
    var noteFolders by remember { mutableStateOf(NoteFolders(emptyMap(), emptyList())) }
    LaunchedEffect(notes, paths) {
        noteFolders = withContext(Dispatchers.Default) {
            val counts = folderCounts(notes, paths)
            NoteFolders(counts, counts.keys.sortedWith(String.CASE_INSENSITIVE_ORDER))
        }
    }
    val counts = noteFolders.counts
    val folders = noteFolders.folders
    var shown by remember { mutableStateOf(notes) }
    LaunchedEffect(notes, paths, query, folder, onlyConflicts, alphaSort) {
        if (query.isNotBlank()) delay(130)
        shown = withContext(Dispatchers.Default) {
            notes.asSequence().filter { note ->
                (!onlyConflicts || note.conflict) &&
                    (folder == null || matchesFolder(note, paths, folder!!)) &&
                    (query.isBlank() || note.title.contains(query, true) ||
                        note.body.contains(query, true) || pathOf(note, paths).contains(query, true))
            }.let { items ->
                if (alphaSort) items.sortedBy { it.title.lowercase() }
                else items.sortedByDescending { it.modifiedAt }
            }.toList()
        }
    }
    BoxWithConstraints(modifier) {
        val wide = maxWidth >= 680.dp
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Notlarım", style = MaterialTheme.typography.headlineLarge)
                    Text("${notes.size} not · Cihazda saklanıyor", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                FilledTonalIconButton(onClick = { alphaSort = !alphaSort }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.SortByAlpha, if (alphaSort) "Tarihe göre sırala" else "Ada göre sırala")
                }
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = onNew, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.Add, "Yeni not")
                }
            }
            OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Başlık, içerik veya dosya yolu ara") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) {
                    Icon(Icons.Rounded.Close, "Aramayı temizle") } },
                singleLine = true, shape = RoundedCornerShape(18.dp))
            if (pathsFailed) Text("Klasör yolları okunamadı. Notlar listelenmeye devam ediyor.",
                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(10.dp))
            if (!wide) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = folder == null && !onlyConflicts, onClick = {
                        folder = null; onlyConflicts = false
                    }, label = { Text("Tümü") })
                    FilterChip(selected = onlyConflicts, onClick = {
                        onlyConflicts = !onlyConflicts; folder = null
                    }, label = { Text("Çakışmalar") })
                    FilterChip(selected = foldersVisible, onClick = { foldersVisible = !foldersVisible },
                        label = { Text("Klasörler") },
                        leadingIcon = { Icon(Icons.Rounded.AccountTree, null, Modifier.size(17.dp)) })
                }
                if (foldersVisible) {
                    Surface(modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainerLow,
                        shape = RoundedCornerShape(18.dp)) {
                        Column(Modifier.padding(8.dp)) {
                            FolderTree(folders, counts, collapsed, folder,
                                modifier = Modifier.heightIn(max = 210.dp),
                                onExpand = { collapsed = if (it in collapsed) collapsed - it else collapsed + it },
                                onSelect = { folder = it; onlyConflicts = false; foldersVisible = false })
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                if (wide) {
                    Surface(modifier = Modifier.width(230.dp).fillMaxHeight(),
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        shape = RoundedCornerShape(20.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column(Modifier.fillMaxSize().padding(12.dp)) {
                            Text("DOSYA GEZGİNİ", modifier = Modifier.padding(10.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            FolderShortcut("Tüm notlar", folder == null && !onlyConflicts) {
                                folder = null; onlyConflicts = false
                            }
                            FolderShortcut("Çakışmalar", onlyConflicts) {
                                onlyConflicts = true; folder = null
                            }
                            HorizontalDivider(Modifier.padding(vertical = 10.dp))
                            FolderTree(folders, counts, collapsed, folder,
                                modifier = Modifier.weight(1f),
                                onExpand = { collapsed = if (it in collapsed) collapsed - it else collapsed + it },
                                onSelect = { folder = it; onlyConflicts = false })
                        }
                    }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (onlyConflicts) "Çakışmalar" else folder?.substringAfterLast('/')?.ifBlank { "Kök" }
                            ?: "Tüm notlar", modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text("${shown.size} dosya", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (shown.isEmpty()) {
                        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(if (query.isNotBlank()) Icons.Rounded.SearchOff else Icons.AutoMirrored.Rounded.NoteAdd,
                                null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.height(12.dp))
                            Text(if (query.isNotBlank()) "Not bulunamadı" else if (onlyConflicts)
                                "Çözüm bekleyen not yok" else "Henüz not yok",
                                style = MaterialTheme.typography.titleSmall)
                            if (query.isBlank() && !onlyConflicts)
                                TextButton(onClick = onNew) { Text("Yeni not oluştur") }
                        }
                    } else LazyColumn(Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(9.dp),
                        contentPadding = PaddingValues(bottom = 24.dp)) {
                        items(shown, key = { it.id }) { note ->
                            VaultNoteRow(note, pathOf(note, paths)) { onOpen(note) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FolderShortcut(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
        .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
            RoundedCornerShape(12.dp)).clickable(onClickLabel = "$label görünümünü aç", onClick = onClick)
        .padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (label == "Çakışmalar") Icons.Rounded.ErrorOutline else Icons.Rounded.Inventory2,
            null, Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun FolderTree(folders: List<String>, counts: Map<String, Int>, collapsed: Set<String>, selected: String?,
                       modifier: Modifier = Modifier,
                       onExpand: (String) -> Unit, onSelect: (String) -> Unit) {
    val parents = remember(folders) {
        folders.mapNotNullTo(mutableSetOf()) { folder ->
            val index = folder.lastIndexOf('/')
            if (index > 0) folder.substring(0, index) else null
        }
    }
    val visible = remember(folders, collapsed) {
        folders.filter { folder ->
            val segments = if (folder.isEmpty()) emptyList() else folder.split('/')
            (1 until segments.size).none { segments.take(it).joinToString("/") in collapsed }
        }
    }
    LazyColumn(modifier.fillMaxWidth()) {
      items(visible, key = { it }) { folder ->
        val segments = if (folder.isEmpty()) emptyList() else folder.split('/')
        val label = folder.substringAfterLast('/').ifBlank { "Kök" }
        val children = folder in parents
        Row(Modifier.fillMaxWidth()
            .background(if (selected == folder) MaterialTheme.colorScheme.primaryContainer
                else Color.Transparent, RoundedCornerShape(12.dp))
            .padding(start = 9.dp * (segments.size - 1).coerceIn(0, 5)),
            verticalAlignment = Alignment.CenterVertically) {
            if (children) IconButton(onClick = { onExpand(folder) }, modifier = Modifier.size(40.dp)) {
                Icon(if (folder in collapsed) Icons.Rounded.ChevronRight else Icons.Rounded.ExpandMore,
                    if (folder in collapsed) "$label klasörünü aç" else "$label klasörünü daralt",
                    Modifier.size(19.dp))
            } else Spacer(Modifier.width(40.dp))
            Row(Modifier.weight(1f).heightIn(min = 48.dp)
                .clickable(onClickLabel = "$label klasörünü göster") { onSelect(folder) }
                .padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (selected == folder) Icons.Rounded.FolderOpen else Icons.Rounded.Folder,
                    null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(7.dp))
                Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${counts[folder] ?: 0}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
      }
    }
}

@Composable
private fun VaultNoteRow(note: EonLocalNote, path: String, onOpen: () -> Unit) {
    Surface(modifier = Modifier.fillMaxWidth().eonGlass().clickable(
        onClickLabel = "${note.title} notunu aç", onClick = onOpen),
        color = Color.Transparent, shape = RoundedCornerShape(24.dp)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(modifier = Modifier.size(42.dp), color = if (note.conflict)
                MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(12.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(if (note.conflict) Icons.Rounded.ErrorOutline else Icons.Rounded.Description,
                        null, Modifier.size(22.dp))
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(note.title.ifBlank { "Başlıksız Not" },
                    style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (note.conflict) "Sürüm çakışmasını incele"
                    else note.body.lineSequence().firstOrNull { it.isNotBlank() }?.trim()?.take(200) ?: "Boş not",
                    style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(path, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    Text(DateFormat.getDateInstance(DateFormat.SHORT).format(Date(note.modifiedAt)),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private enum class NoteMode { EDIT, READ }

@Composable
fun EonNoteEditor(modifier: Modifier, note: EonLocalNote?, onBack: () -> Unit,
                  onSave: suspend (String, String) -> Unit, onDelete: suspend () -> Unit,
                  onCommitted: () -> Unit, message: String?) {
    val context = LocalContext.current
    val drafts = remember(context) { NoteDrafts(context.applicationContext) }
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current
    val draftWrites = remember(note?.id) { Mutex() }
    var title by remember(note?.id) { mutableStateOf(note?.title ?: "") }
    var body by remember(note?.id) { mutableStateOf(TextFieldValue(note?.body ?: "")) }
    var undoStack by remember(note?.id) { mutableStateOf(emptyList<TextFieldValue>()) }
    var redoStack by remember(note?.id) { mutableStateOf(emptyList<TextFieldValue>()) }
    var loaded by remember(note?.id) { mutableStateOf(false) }
    var draftMessage by remember(note?.id) { mutableStateOf<String?>(null) }
    var confirmDelete by remember(note?.id) { mutableStateOf(false) }
    var oldDraft by remember(note?.id) { mutableStateOf<JSONObject?>(null) }
    var busy by remember(note?.id) { mutableStateOf(false) }
    var mode by rememberSaveable(note?.id) { mutableStateOf(NoteMode.EDIT.name) }
    var focus by rememberSaveable(note?.id) { mutableStateOf(false) }
    var savedSnapshot by remember(note?.id) { mutableStateOf<Pair<String, String>?>(null) }
    var wordCount by remember(note?.id) { mutableIntStateOf(-1) }
    val changed = title != (note?.title ?: "") || body.text != (note?.body ?: "")
    val canEdit = loaded && oldDraft == null && !busy
    val canSave = canEdit && changed && (title.isNotBlank() || body.text.isNotBlank())

    val bodyForCount = body.text
    LaunchedEffect(bodyForCount, focus) {
        if (!focus) {
            delay(180)
            wordCount = withContext(Dispatchers.Default) { countNoteWords(bodyForCount) }
        }
    }

    LaunchedEffect(note?.id) {
        try {
            val draft = withContext(Dispatchers.IO) { drafts.read(note?.id) }
            if (draft != null) {
                if (draft.optString("revision") == note?.revisionId ||
                    (note == null && draft.isNull("revision"))) {
                    title = draft.getString("title")
                    body = TextFieldValue(draft.getString("body"))
                } else oldDraft = draft
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            draftMessage = "Taslak okunamadı: ${error.message}"
        }
        loaded = true
    }
    suspend fun persistDraft() {
        val titleSnapshot = title
        val bodySnapshot = body.text
        withContext(Dispatchers.IO) {
            if (titleSnapshot != (note?.title ?: "") || bodySnapshot != (note?.body ?: ""))
                drafts.write(note?.id, titleSnapshot, bodySnapshot, note?.revisionId)
            else drafts.remove(note?.id)
        }
        savedSnapshot = titleSnapshot to bodySnapshot
    }
    fun perform(operation: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                draftWrites.withLock { operation() }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                draftMessage = error.message ?: "Not işlemi tamamlanamadı."
            } finally {
                busy = false
            }
        }
    }
    LaunchedEffect(title, body.text, loaded, oldDraft, busy) {
        if (loaded && oldDraft == null && !busy) {
            delay(250)
            try {
                draftWrites.withLock { persistDraft() }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                draftMessage = "Taslak saklanamadı: ${error.message}"
            }
        }
    }
    DisposableEffect(lifecycleOwner, loaded, oldDraft, busy) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && loaded && oldDraft == null && !busy) {
                scope.launch {
                    try {
                        draftWrites.withLock { persistDraft() }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        draftMessage = "Taslak saklanamadı: ${error.message}"
                    }
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val leave: () -> Unit = { perform {
        if (loaded && oldDraft == null) persistDraft()
        onBack()
    } }
    fun commit(operation: suspend () -> Unit) = perform {
        operation()
        withContext(Dispatchers.IO) { drafts.remove(note?.id) }
        onCommitted()
    }
    fun rememberHistory(stack: List<TextFieldValue>, value: TextFieldValue): List<TextFieldValue> {
        // Bound snapshots so editing large notes cannot retain hundreds of megabytes.
        val limit = 1_000_000
        if (value.text.length > limit) return emptyList()
        var size = 0
        return (stack + value).asReversed().takeWhile {
            size += it.text.length
            size <= limit
        }.take(100).asReversed()
    }
    fun updateBody(value: TextFieldValue) {
        if (value.text != body.text) {
            undoStack = rememberHistory(undoStack, body)
            redoStack = emptyList()
        }
        body = value
    }
    fun insertAround(prefix: String, suffix: String = "") {
        val start = body.selection.min
        val end = body.selection.max
        val text = body.text
        val replacement = text.substring(0, start) + prefix + text.substring(start, end) +
            suffix + text.substring(end)
        updateBody(TextFieldValue(replacement, TextRange(if (start == end) start + prefix.length
            else end + prefix.length)))
    }
    fun insertLine(prefix: String) {
        val start = body.selection.min
        val position = body.text.lastIndexOf('\n', start - 1) + 1
        updateBody(TextFieldValue(body.text.substring(0, position) + prefix + body.text.substring(position),
            TextRange(start + prefix.length)))
    }

    BackHandler { leave() }
    BoxWithConstraints(modifier.imePadding()) {
        val wide = maxWidth >= 650.dp
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = leave, enabled = !busy, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Notlara dön")
                }
                Column(Modifier.weight(1f)) {
                    Text(if (note == null) "Yeni Markdown notu" else "Not kasası",
                        style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    Text(when {
                        oldDraft != null -> "Taslak için sürüm onayı gerekiyor"
                        draftMessage != null -> "Taslak kaydedilemedi"
                        !loaded -> "Yükleniyor…"
                        !changed -> "Kaydedilmiş sürüm"
                        savedSnapshot == (title to body.text) -> "Yerel taslak kaydedildi"
                        else -> "Taslak kaydediliyor…"
                    }, style = MaterialTheme.typography.labelSmall,
                        color = if (oldDraft != null || draftMessage != null)
                            MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (note != null) IconButton(onClick = { confirmDelete = true },
                    enabled = canEdit, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Rounded.DeleteOutline, "Notu sil")
                }
                IconButton(onClick = { focus = !focus }, enabled = loaded, modifier = Modifier.size(48.dp)) {
                    Icon(if (focus) Icons.Rounded.FullscreenExit else Icons.Rounded.Fullscreen,
                        if (focus) "Odak modundan çık" else "Odak modu")
                }
                Button(onClick = { commit { onSave(title, body.text) } }, enabled = canSave,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 9.dp)) {
                    Text("Kaydet")
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
            Column(Modifier.fillMaxSize().widthIn(max = if (wide) 840.dp else 900.dp)
                .padding(horizontal = if (wide) 32.dp else 20.dp)) {
                if (!focus) {
                    Spacer(Modifier.height(16.dp))
                    Text("DOSYA BAŞLIĞI", style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                }
                BasicTextField(title, { title = it.take(256) },
                    enabled = canEdit, singleLine = true,
                    textStyle = MaterialTheme.typography.headlineMedium.copy(
                        color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 57.dp)
                        .semantics { contentDescription = "Not başlığı" },
                    decorationBox = { inner -> Box(contentAlignment = Alignment.CenterStart) {
                        if (title.isEmpty()) Text("Başlıksız not",
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        inner()
                    } })
                if (!focus) {
                    Text("Markdown · ${if (wordCount < 0) "…" else wordCount} kelime · ${body.text.length} karakter",
                        modifier = Modifier.padding(bottom = 8.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    FilterChip(selected = mode == NoteMode.EDIT.name, onClick = {
                        mode = NoteMode.EDIT.name
                    }, enabled = canEdit,
                        label = { Text("Düzenle") },
                        leadingIcon = { Icon(Icons.Rounded.Edit, null, Modifier.size(17.dp)) })
                    FilterChip(selected = mode == NoteMode.READ.name, onClick = {
                        mode = NoteMode.READ.name
                    }, enabled = loaded && oldDraft == null,
                        label = { Text("Önizleme") },
                        leadingIcon = { Icon(Icons.Rounded.Visibility, null, Modifier.size(17.dp)) })
                    Spacer(Modifier.weight(1f))
                    if (!focus) Text("MD", style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
                Surface(modifier = Modifier.weight(1f).fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    shape = RoundedCornerShape(18.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))) {
                    if (mode == NoteMode.READ.name) {
                        MarkdownReader(body.text, enabled = canEdit, onToggleTask = { offset ->
                            val current = body.text
                            if (offset >= 0 && offset + 2 < current.length && current[offset] == '[' &&
                                current[offset + 2] == ']') {
                                val marker = if (current[offset + 1] == ' ') 'x' else ' '
                                updateBody(body.copy(text = current.replaceRange(offset + 1, offset + 2, "$marker")))
                            }
                        })
                    } else {
                        BasicTextField(body, ::updateBody, enabled = canEdit,
                            textStyle = MaterialTheme.typography.bodyLarge.copy(
                                color = MaterialTheme.colorScheme.onSurface, lineHeight = 26.sp,
                                fontFamily = FontFamily.Monospace),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            modifier = Modifier.fillMaxSize().padding(16.dp)
                                .semantics { contentDescription = "Markdown not içeriği" },
                            decorationBox = { inner -> Box {
                                if (body.text.isEmpty()) Text("Bir düşünceyle başla…\n\n# Başlık\n- İlk fikrin\n- [ ] Yapılacaklar",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                inner()
                            } })
                    }
                }
                if (mode == NoteMode.EDIT.name && !focus) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                        .padding(vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        NoteFormatAction("Geri al", canEdit && undoStack.isNotEmpty()) {
                            val previous = undoStack.last()
                            undoStack = undoStack.dropLast(1)
                            redoStack = rememberHistory(redoStack, body)
                            body = previous
                        }
                        NoteFormatAction("Yinele", canEdit && redoStack.isNotEmpty()) {
                            val next = redoStack.last()
                            redoStack = redoStack.dropLast(1)
                            undoStack = rememberHistory(undoStack, body)
                            body = next
                        }
                        NoteFormatAction("H1", canEdit) { insertLine("# ") }
                        NoteFormatAction("H2", canEdit) { insertLine("## ") }
                        NoteFormatAction("H3", canEdit) { insertLine("### ") }
                        NoteFormatAction("Kalın", canEdit) { insertAround("**", "**") }
                        NoteFormatAction("İtalik", canEdit) { insertAround("*", "*") }
                        NoteFormatAction("Üstü çizili", canEdit) { insertAround("~~", "~~") }
                        NoteFormatAction("Liste", canEdit) { insertLine("- ") }
                        NoteFormatAction("Numaralı", canEdit) { insertLine("1. ") }
                        NoteFormatAction("Görev", canEdit) { insertLine("- [ ] ") }
                        NoteFormatAction("Alıntı", canEdit) { insertLine("> ") }
                        NoteFormatAction("Kod", canEdit) { insertAround("`", "`") }
                        NoteFormatAction("Kod bloğu", canEdit) { insertAround("```\n", "\n```") }
                        NoteFormatAction("Bağlantı", canEdit) { insertAround("[", "](https://)") }
                        NoteFormatAction("Not bağlantısı", canEdit) { insertAround("[[", "]]") }
                    }
                }
                if (!focus) Text(
                    "Taslak otomatik saklanır. Diğer cihazlara aktarmak için Kaydet.",
                    modifier = Modifier.fillMaxWidth().padding(bottom = 7.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                (draftMessage ?: message)?.let {
                    Text(it, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false },
        title = { Text("Not silinsin mi?") },
        text = { Text("Silme işlemi bağlı cihazlara da eşitlenir.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; commit(onDelete) }) { Text("Sil") } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Vazgeç") } })
    oldDraft?.let { draft ->
        AlertDialog(onDismissRequest = onBack,
            title = { Text("Kaydedilmemiş taslak") },
            text = { Text("Bu not başka bir cihazda değişmiş. Eski taslağını yeni sürüm üzerine açmak ister misin? Kaydetmeden önce değişiklikleri incele.") },
            confirmButton = { TextButton(onClick = {
                title = draft.getString("title")
                body = TextFieldValue(draft.getString("body"))
                oldDraft = null
                savedSnapshot = null
            }) { Text("Taslağı incele") } },
            dismissButton = { TextButton(onClick = onBack) { Text("Geri dön") } })
    }
}

@Composable
private fun NoteFormatAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.heightIn(min = 45.dp),
        contentPadding = PaddingValues(horizontal = 13.dp, vertical = 6.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

private enum class MarkdownKind { HEADING, TEXT, LIST, QUOTE, TASK, CODE, RULE }
private data class MarkdownBlock(
    val index: Int,
    val kind: MarkdownKind,
    val text: String,
    val level: Int = 0,
    val taskOffset: Int = -1,
    val checked: Boolean = false,
)
private val headingPattern = Regex("""^(#{1,6})\s+(.+)$""")
private val taskPattern = Regex("""^\s*[-*+]\s+\[([ xX])]\s*(.*)$""")
private val bulletPattern = Regex("""^\s*(?:[-*+]\s+|\d+\.\s+)(.*)$""")
private val rulePattern = Regex("""^\s*(?:-{3,}|\*{3,}|_{3,})\s*$""")
private val inlinePattern = Regex("""(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[\[[^\n]+?]]|\[[^\n]+?]\([^)]+\))""")

private fun parseMarkdown(markdown: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val lines = markdown.split('\n')
    var offset = 0
    var index = 0
    while (index < lines.size) {
        val line = lines[index].removeSuffix("\r")
        val trimmed = line.trim()
        if (trimmed.startsWith("```")) {
            val opening = index
            val code = mutableListOf<String>()
            offset += lines[index].length + 1
            index++
            while (index < lines.size && !lines[index].trim().startsWith("```")) {
                code += lines[index].removeSuffix("\r")
                offset += lines[index].length + 1
                index++
            }
            if (index < lines.size) {
                offset += lines[index].length + 1
                index++
            }
            blocks += MarkdownBlock(opening, MarkdownKind.CODE, code.joinToString("\n"))
            continue
        }
        if (trimmed.isNotEmpty()) {
            val heading = headingPattern.matchEntire(trimmed)
            val task = taskPattern.matchEntire(line)
            val bullet = bulletPattern.matchEntire(line)
            when {
                rulePattern.matches(trimmed) ->
                    blocks += MarkdownBlock(index, MarkdownKind.RULE, "")
                heading != null ->
                    blocks += MarkdownBlock(index, MarkdownKind.HEADING,
                        heading.groupValues[2], level = heading.groupValues[1].length)
                task != null ->
                    blocks += MarkdownBlock(index, MarkdownKind.TASK, task.groupValues[2],
                        taskOffset = offset + line.indexOf('['),
                        checked = task.groupValues[1].equals("x", true))
                trimmed.startsWith(">") ->
                    blocks += MarkdownBlock(index, MarkdownKind.QUOTE, trimmed.removePrefix(">").trimStart())
                bullet != null ->
                    blocks += MarkdownBlock(index, MarkdownKind.LIST, bullet.groupValues[1])
                else -> blocks += MarkdownBlock(index, MarkdownKind.TEXT, line)
            }
        }
        offset += lines[index].length + 1
        index++
    }
    return blocks
}

@Composable
private fun richMarkdown(text: String): androidx.compose.ui.text.AnnotatedString {
    val primary = MaterialTheme.colorScheme.primary
    return remember(text, primary) {
        buildAnnotatedString {
            var cursor = 0
            inlinePattern.findAll(text).forEach { match ->
                append(text.substring(cursor, match.range.first))
                val token = match.value
                when {
                    token.startsWith("**") -> {
                        pushStyle(SpanStyle(fontWeight = FontWeight.Bold))
                        append(token.removeSurrounding("**"))
                        pop()
                    }
                    token.startsWith("`") -> {
                        pushStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = primary))
                        append(token.removeSurrounding("`"))
                        pop()
                    }
                    token.startsWith("*") -> {
                        pushStyle(SpanStyle(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic))
                        append(token.removeSurrounding("*"))
                        pop()
                    }
                    token.startsWith("[[") -> {
                        pushStyle(SpanStyle(color = primary, fontWeight = FontWeight.Medium))
                        append(token.removeSurrounding("[[", "]]"))
                        pop()
                    }
                    token.startsWith("[") -> {
                        pushStyle(SpanStyle(color = primary))
                        append(token.substringAfter('[').substringBefore(']'))
                        pop()
                    }
                }
                cursor = match.range.last + 1
            }
            append(text.substring(cursor))
        }
    }
}

@Composable
private fun MarkdownReader(markdown: String, enabled: Boolean, onToggleTask: (Int) -> Unit) {
    var blocks by remember { mutableStateOf<List<MarkdownBlock>>(emptyList()) }
    LaunchedEffect(markdown) {
        blocks = withContext(Dispatchers.Default) { parseMarkdown(markdown) }
    }
    if (blocks.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.TopStart) {
            Text("Bu not henüz boş. İçerik eklemek için Düzenle seçeneğini kullan.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp)) {
        items(blocks, key = { it.index }) { block ->
            when (block.kind) {
                MarkdownKind.HEADING -> Text(richMarkdown(block.text),
                    style = when (block.level) {
                        1 -> MaterialTheme.typography.headlineMedium
                        2 -> MaterialTheme.typography.headlineSmall
                        3 -> MaterialTheme.typography.titleLarge
                        else -> MaterialTheme.typography.titleMedium
                    }, fontWeight = FontWeight.Bold)
                MarkdownKind.TEXT -> Text(richMarkdown(block.text),
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp))
                MarkdownKind.LIST -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("•", color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodyLarge)
                    Text(richMarkdown(block.text), modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp))
                }
                MarkdownKind.TASK -> Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Checkbox(checked = block.checked, onCheckedChange = { onToggleTask(block.taskOffset) },
                        enabled = enabled, modifier = Modifier.size(48.dp)
                            .semantics { contentDescription = "Görev: ${block.text}" })
                    Text(richMarkdown(block.text), modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (block.checked) MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.onSurface)
                }
                MarkdownKind.QUOTE -> Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.width(3.dp).height(30.dp).background(
                        MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)))
                    Text(richMarkdown(block.text), modifier = Modifier.padding(start = 14.dp),
                        style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                MarkdownKind.CODE -> Surface(color = MaterialTheme.colorScheme.surfaceContainerHighest,
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(block.text.ifBlank { " " },
                        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(14.dp),
                        fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                }
                MarkdownKind.RULE ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
