package com.kapanis.mobil.eon2.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.kapanis.mobil.eon2.protocol.CanonicalNotes
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

private const val MAX_NOTE_BODY_BYTES = 5 * 1024 * 1024

/** Match the desktop repository's UTF-8 byte limit, including for multibyte Unicode. */
internal fun isNoteBodyWithinLimit(body: String): Boolean =
    body.length <= MAX_NOTE_BODY_BYTES && body.toByteArray(Charsets.UTF_8).size <= MAX_NOTE_BODY_BYTES

data class EonLocalNote(
    val id: String,
    val title: String,
    val body: String,
    val revisionId: String,
    val modifiedAt: Long,
    val conflict: Boolean = false,
)

data class SyncApplyResult(val applied: Int, val duplicates: Int, val conflictedNotes: Int)

data class EonConflictHead(
    val revisionId: String,
    val title: String,
    val content: String,
    val deleted: Boolean,
    val parents: List<String>,
    val path: String? = null,
)

data class EonNoteConflict(
    val noteId: String,
    val heads: List<EonConflictHead>,
    val pendingRevisionIds: List<String>,
    val pathCollision: Boolean = false,
)

/** Local SQLite authority. An operation and its projected note commit in one transaction. */
class EonNotesRepository(context: Context) : SQLiteOpenHelper(context.applicationContext, "eon2-notes.db", null, 1) {
    companion object {
        @Volatile private var shared: EonNotesRepository? = null

        /** Process-owned UI connection; rotation must not leave another SQLite pool open. */
        fun shared(context: Context): EonNotesRepository = shared ?: synchronized(this) {
            shared ?: EonNotesRepository(context.applicationContext).also { shared = it }
        }
    }
    private val preferences = context.getSharedPreferences("eon2-local-state", Context.MODE_PRIVATE)
    val deviceId: String = preferences.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
        check(preferences.edit().putString("deviceId", it).commit())
    }

    val vaultId: String
        get() {
            val fromDatabase = readableDatabase.rawQuery("SELECT value FROM meta WHERE key='vault-id'", null)
                .use { if (it.moveToFirst()) it.getString(0) else null }
            if (fromDatabase != null) return fromDatabase
            return preferences.getString("vaultId", null) ?: UUID.randomUUID().toString().also {
                check(preferences.edit().putString("vaultId", it).commit())
            }
        }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,revision_id TEXT NOT NULL,modified_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,conflict INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE operations(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,sequence INTEGER NOT NULL,note_id TEXT NOT NULL,revision_id TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(device_id,sequence))")
        db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        db.execSQL("CREATE INDEX operations_note ON operations(note_id)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        error("Unsupported Eon Notes DB migration $oldVersion -> $newVersion")
    }

    fun list(): List<EonLocalNote> = readableDatabase.rawQuery(
        "SELECT id,title,body,revision_id,modified_at,conflict FROM notes WHERE deleted=0 ORDER BY modified_at DESC,id ASC", null
    ).use { cursor ->
        buildList {
            while (cursor.moveToNext()) add(EonLocalNote(cursor.getString(0),cursor.getString(1),cursor.getString(2),cursor.getString(3),cursor.getLong(4),cursor.getInt(5) != 0))
        }
    }

    fun save(id: String?, expectedRevisionId: String?, title: String, body: String): EonLocalNote {
        require(title.length <= 256 && isNoteBodyWithinLimit(body)) { "Not çok büyük." }
        val noteId = id ?: UUID.randomUUID().toString()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val previous = readRow(db, noteId)
            if (id != null && previous == null) error("Not bulunamadı.")
            if (previous != null && previous.revisionId != expectedRevisionId) error("Not farklı bir revizyonda değişti.")
            if (previous?.conflict == true) error("Notun çakışması çözülmeden düzenlenemez.")
            // A remote peer can contribute metadata keys this Android version does not know.
            // Preserve the complete head metadata and modify only the title the user edited.
            val metadata = if (previous == null) {
                JSONObject().put("path", "Notes/$noteId.md")
            } else {
                val oldHead = db.rawQuery("SELECT payload FROM operations WHERE revision_id=? LIMIT 1", arrayOf(previous.revisionId))
                    .use { cursor -> if (cursor.moveToFirst()) JSONObject(cursor.getString(0)).getJSONObject("revision") else null }
                    ?: error("Notun önceki revizyonu bulunamadı; değişiklik güvenle kaydedilemez.")
                JSONObject(oldHead.getJSONObject("metadata").toString())
            }
            metadata.put("title", title.ifBlank { "Başlıksız Not" })
            val revision = CanonicalNotes.revision(noteId, previous?.let { listOf(it.revisionId) } ?: emptyList(), false,
                body, metadata)
            val op = CanonicalNotes.operation(vaultId, deviceId, nextSequence(db), revision)
            insertOperation(db, op)
            val now = System.currentTimeMillis()
            upsertNote(db, EonLocalNote(noteId, title.ifBlank { "Başlıksız Not" }, body, revision.getString("id"), now))
            db.setTransactionSuccessful()
            return EonLocalNote(noteId, title.ifBlank { "Başlıksız Not" }, body, revision.getString("id"), now)
        } finally { db.endTransaction() }
    }

    fun delete(id: String, expectedRevisionId: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val previous = readRow(db, id) ?: error("Not bulunamadı.")
            check(!previous.conflict && previous.revisionId == expectedRevisionId) { "Çakışma: Notun sürümü değişmiş." }
            val revision = CanonicalNotes.revision(id, listOf(previous.revisionId), true, null, null)
            insertOperation(db, CanonicalNotes.operation(vaultId, deviceId, nextSequence(db), revision))
            db.execSQL("UPDATE notes SET deleted=1,revision_id=?,modified_at=? WHERE id=?", arrayOf(revision.getString("id"), System.currentTimeMillis(), id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    /** All divergent branch bodies remain in the immutable operation log until explicitly resolved. */
    fun conflict(noteId: String): EonNoteConflict? {
        val allOperations = operations()
        val revisions = allOperations.map { it.getJSONObject("revision") }
        val projection = projectHeads(allOperations)
        val projected = projection[noteId] ?: return null
        val byId = revisions.associateBy { it.getString("id") }
        val hasCollision = noteId in collidingNotes(projection, byId)
        if (projected.first.size < 2 && projected.second.isEmpty() && !hasCollision) return null
        val heads = projected.first.sorted().mapNotNull { id ->
            val rev = byId[id] ?: return@mapNotNull null
            val deleted = rev.getBoolean("deleted")
            EonConflictHead(
                id,
                if (deleted) "Silme işlemi" else rev.getJSONObject("metadata").optString("title", "Başlıksız Not"),
                if (deleted) "" else rev.getString("body"),
                deleted,
                rev.getJSONArray("parents").let { parents -> (0 until parents.length()).map { parents.getString(it) } },
                if (deleted) null else rev.getJSONObject("metadata").optString("path").ifBlank { null },
            )
        }
        return EonNoteConflict(noteId, heads, projected.second.sorted(), hasCollision)
    }

    fun resolveConflict(noteId: String, expectedHeads: List<String>, chosenRevisionId: String, title: String, body: String, chooseDeletion: Boolean = false, newPath: String? = null): EonLocalNote {
        // A tombstone has no body. Let the user delete even if a conflicting head is oversized.
        require(chooseDeletion || (title.length <= 256 && isNoteBodyWithinLimit(body))) { "Not çok büyük." }
        val db = writableDatabase
        db.beginTransaction()
        try {
            val ops = operations(db)
            val projection = projectHeads(ops)
            val state = projection[noteId] ?: error("Not bulunamadı.")
            val revisions = ops.map { it.getJSONObject("revision") }.associateBy { it.getString("id") }
            val hasCollision = noteId in collidingNotes(projection, revisions)
            check(state.second.isEmpty() && (state.first.size >= 2 || hasCollision)) { "Çözüm öncesinde atalar eşitlenmeli veya yol çakışması bulunmalı." }
            check(state.first.sorted() == expectedHeads.sorted() && expectedHeads.distinct().size == expectedHeads.size) { "Not sürümleri değişti; tekrar incele." }
            check(chosenRevisionId in state.first) { "Seçilen sürüm geçersiz." }
            val picked = revisions[chosenRevisionId] ?: error("Not sürümü bulunamadı.")
            if (chooseDeletion) {
                check(picked.getBoolean("deleted")) { "Silme kararı için silinmiş bir sürüm seçilmeli." }
                val revision = CanonicalNotes.revision(noteId, state.first.sorted(), true, null, null)
                insertOperation(db, CanonicalNotes.operation(vaultId, deviceId, nextSequence(db), revision))
                val updatedAt = System.currentTimeMillis()
                db.execSQL("UPDATE notes SET deleted=1,conflict=0,revision_id=?,modified_at=? WHERE id=?",
                    arrayOf(revision.getString("id"), updatedAt, noteId))
                db.setTransactionSuccessful()
                return EonLocalNote(noteId, title, body, revision.getString("id"), updatedAt)
            }
            check(!picked.getBoolean("deleted")) { "Silinmiş sürüm sessizce geri getirilemez. Canlı sürümü seç." }
            val metadata = if (picked.getBoolean("deleted")) {
                revisions.values.firstOrNull { !it.getBoolean("deleted") && it.getString("noteId") == noteId }
                    ?.getJSONObject("metadata") ?: JSONObject()
            } else picked.getJSONObject("metadata")
            val mergedMetadata = JSONObject(metadata.toString()).put("title", title.ifBlank { "Başlıksız Not" })
            if (hasCollision) {
                check(newPath != null && CanonicalNotes.isSafeRelativeNotePath(newPath)) { "Farklı ve güvenli bir Markdown dosya yolu seç." }
                mergedMetadata.put("path", newPath)
            }
            val revision = CanonicalNotes.revision(noteId, state.first.sorted(), false, body, mergedMetadata)
            insertOperation(db, CanonicalNotes.operation(vaultId, deviceId, nextSequence(db), revision))
            val afterOps = operations(db)
            val afterProjection = projectHeads(afterOps)
            val afterRevisions = afterOps.map { it.getJSONObject("revision") }.associateBy { it.getString("id") }
            check(noteId !in collidingNotes(afterProjection, afterRevisions)) { "Yeni dosya yolu başka notla çakışıyor." }
            val result = EonLocalNote(noteId, title.ifBlank { "Başlıksız Not" }, body, revision.getString("id"), System.currentTimeMillis())
            upsertNote(db, result)
            db.setTransactionSuccessful()
            return result
        } finally { db.endTransaction() }
    }

    fun manifest(): JSONObject {
        val ops = operations()
        val heads = projectHeads(ops)
        val notesJson = JSONArray()
        heads.toSortedMap().forEach { (id, state) ->
            notesJson.put(JSONObject().put("noteId", id).put("heads", JSONArray(state.first.sorted())).put("pending", JSONArray(state.second.sorted())))
        }
        val objectWithoutHash = JSONObject().put("version", 1).put("vaultId", vaultId)
            .put("knownOperations", JSONArray(ops.map { it.getString("id") }.distinct().sorted())).put("notes", notesJson)
        return objectWithoutHash.put("sha256", CanonicalNotes.hashJson(objectWithoutHash))
    }

    fun deltaFor(remoteManifest: JSONObject, limit: Int = 500): JSONObject {
        require(remoteManifest.getString("vaultId") == vaultId) { "Different vault" }
        val unsigned = JSONObject(remoteManifest.toString()).apply { remove("sha256") }
        require(remoteManifest.getInt("version") == 1 && remoteManifest.getString("sha256") == CanonicalNotes.hashJson(unsigned)) { "Manifest corrupted" }
        val known = remoteManifest.getJSONArray("knownOperations").let { value ->
            (0 until value.length()).map { value.getString(it) }.toHashSet()
        }
        require(limit in 1..500)
        val toSend = mutableListOf<JSONObject>()
        var bytes = 120
        val maximumBatchBytes = 24 * 1024 * 1024
        for (operation in operations()) {
            if (operation.getString("id") in known) continue
            val operationBytes = CanonicalNotes.json(operation).toByteArray(Charsets.UTF_8).size + 1
            if (operationBytes > maximumBatchBytes) {
                error("Tek bir not güncellemesi aktarım sınırını aşıyor. İçerik yerelde korunuyor; parça aktarımı gerekli.")
            }
            if (toSend.isNotEmpty() && bytes + operationBytes > maximumBatchBytes) break
            toSend += operation
            bytes += operationBytes
            if (toSend.size >= limit) break
        }
        val base = JSONObject().put("version",1).put("vaultId",vaultId).put("operations",JSONArray(toSend))
        return base.put("sha256",CanonicalNotes.hashJson(base))
    }

    fun receiveDelta(delta: JSONObject): SyncApplyResult {
        require(delta.keys().asSequence().toSet() == setOf("version", "vaultId", "operations", "sha256") &&
            delta.get("version") is Number && delta.getInt("version") == 1) { "Unsupported delta envelope" }
        val withoutHash = JSONObject(delta.toString()).apply { remove("sha256") }
        check(delta.getString("sha256") == CanonicalNotes.hashJson(withoutHash)) { "Delta checksum mismatch" }
        check(delta.getString("vaultId") == vaultId) { "Wrong vault" }
        val incoming = delta.getJSONArray("operations")
        require(incoming.length() <= 500) { "Sync batch too large" }
        val db = writableDatabase
        db.beginTransaction()
        try {
            var applied = 0
            var duplicate = 0
            val changedNoteIds = mutableSetOf<String>()
            for (index in 0 until incoming.length()) {
                val op = incoming.getJSONObject(index)
                CanonicalNotes.verifyOperation(op, vaultId)
                val revision = op.getJSONObject("revision")
                if (!revision.getBoolean("deleted")) {
                    require(isNoteBodyWithinLimit(revision.getString("body"))) {
                        "Alınan not 5 MiB UTF-8 sınırını aşıyor; mevcut veriler korunuyor."
                    }
                }
                val existing = db.rawQuery("SELECT payload FROM operations WHERE id=?", arrayOf(op.getString("id"))).use {
                    if (it.moveToFirst()) it.getString(0) else null
                }
                if (existing != null) {
                    check(CanonicalNotes.json(JSONObject(existing)) == CanonicalNotes.json(op)) { "Operation ID collision" }
                    duplicate++
                    continue
                }
                check(op.getString("deviceId") != deviceId) { "Uzak cihaz yerel işlem kimliğini kullanamaz." }
                insertOperation(db, op)
                applied++
                changedNoteIds += revision.getString("noteId")
            }
            // A repeated delta contains no new state. Avoid reparsing the entire journal
            // and rewriting every note just to acknowledge operations already committed.
            if (changedNoteIds.isEmpty()) {
                val conflicted = db.rawQuery("SELECT COUNT(*) FROM notes WHERE conflict=1", null).use { cursor ->
                    cursor.moveToFirst()
                    cursor.getInt(0)
                }
                db.setTransactionSuccessful()
                return SyncApplyResult(0, duplicate, conflicted)
            }
            val allOperations = operations(db)
            val projection = projectHeads(allOperations)
            var conflicted = 0
            val revisions = allOperations.map { it.getJSONObject("revision") }.associateBy { it.getString("id") }
            val collisions = collidingNotes(projection, revisions)
            // Path collisions can affect other notes; previous conflicts must also be
            // revisited so that a newly resolved collision is cleared on both sides.
            val previouslyConflicted = db.rawQuery("SELECT id FROM notes WHERE conflict=1", null).use { cursor ->
                buildSet { while (cursor.moveToNext()) add(cursor.getString(0)) }
            }
            val affectedNoteIds = changedNoteIds + collisions + previouslyConflicted
            projection.forEach { (noteId, state) ->
                val hasConflict = state.second.isNotEmpty() || state.first.size > 1 || noteId in collisions
                if (hasConflict) conflicted++
                if (noteId !in affectedNoteIds) return@forEach
                if (hasConflict) {
                        db.execSQL("INSERT OR IGNORE INTO notes(id,title,body,revision_id,modified_at,deleted,conflict) VALUES(?,?,?,?,?,0,1)",
                            arrayOf<Any>(noteId,"Çakışan not sürümleri","",state.first.firstOrNull() ?: "",System.currentTimeMillis()))
                        // readRow excludes deleted rows. A concurrent edit of a deleted note
                        // must still surface its conflict rather than stay hidden by deleted=1.
                        db.execSQL("UPDATE notes SET conflict=1,deleted=0 WHERE id=?", arrayOf(noteId))
                    return@forEach
                }
                val head = state.first.singleOrNull() ?: return@forEach
                val revision = revisions[head] ?: return@forEach
                val deleted = revision.getBoolean("deleted")
                val title = if (deleted) "Silinen not" else revision.getJSONObject("metadata").optString("title","Başlıksız Not")
                val body = if (deleted) "" else revision.getString("body")
                db.execSQL("INSERT OR REPLACE INTO notes(id,title,body,revision_id,modified_at,deleted,conflict) VALUES(?,?,?,?,?,?,0)",
                    arrayOf(noteId,title,body,head,System.currentTimeMillis(),if (deleted) 1 else 0))
            }
            db.setTransactionSuccessful()
            return SyncApplyResult(applied, duplicate, conflicted)
        } finally { db.endTransaction() }
    }

    /** First pairing rewrites envelopes atomically, retaining all offline notes and an audit archive. */
    fun adoptVault(newVaultId: String) {
        require(newVaultId.length in 1..256)
        CanonicalNotes.json(newVaultId)
        val db = writableDatabase
        db.beginTransaction()
        try {
            val currentVaultId = vaultId
            val alreadyPaired = db.rawQuery("SELECT 1 FROM meta WHERE key='paired-vault'", null).use { it.moveToFirst() }
            if (alreadyPaired && currentVaultId != newVaultId) error("Eşleşmiş defter kimliği otomatik değiştirilemez.")
            if (currentVaultId != newVaultId) {
                val previous = operations(db)
                check(previous.all { it.getString("deviceId") == deviceId }) { "Uzak cihaz revizyonları olan defter taşınamaz." }
                db.execSQL("CREATE TABLE IF NOT EXISTS journal_migration_archive(archived_at INTEGER,old_vault_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(old_vault_id,operation_id))")
                previous.forEach { op ->
                    db.execSQL("INSERT OR IGNORE INTO journal_migration_archive(archived_at,old_vault_id,operation_id,payload) VALUES(?,?,?,?)",
                        arrayOf(System.currentTimeMillis(),currentVaultId,op.getString("id"),CanonicalNotes.json(op)))
                }
                db.execSQL("DELETE FROM operations")
                previous.forEach { previousOp ->
                    insertOperation(db,CanonicalNotes.operation(newVaultId,deviceId,previousOp.getLong("sequence"),previousOp.getJSONObject("revision")))
                }
            }
            db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES('vault-id',?)", arrayOf(newVaultId))
            db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES('paired-vault','true')")
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun operations(db: SQLiteDatabase = readableDatabase): List<JSONObject> = db.rawQuery(
        "SELECT payload FROM operations ORDER BY device_id,sequence,id", null
    ).use { cursor -> buildList { while (cursor.moveToNext()) add(JSONObject(cursor.getString(0))) } }

    private fun projectHeads(ops: List<JSONObject>): Map<String, Pair<Set<String>, Set<String>>> {
        val all = ops.map { it.getJSONObject("revision") }.associateBy { it.getString("id") }
        val knownGood = mutableMapOf<String, Boolean>()
        fun valid(id: String, visiting: Set<String> = emptySet()): Boolean {
            knownGood[id]?.let { return it }
            val current = all[id] ?: return false
            check(id !in visiting) { "Cyclic revision ancestry" }
            val ancestors = current.getJSONArray("parents")
            val result = (0 until ancestors.length()).all { index ->
                val parentId = ancestors.getString(index)
                val parent = all[parentId]
                check(parent == null || parent.getString("noteId") == current.getString("noteId")) {
                    "Parent revision belongs to another note"
                }
                valid(parentId, visiting + id)
            }
            knownGood[id] = result
            return result
        }
        val validIds = all.keys.filter { valid(it) }.toSet()
        return all.values.groupBy { it.getString("noteId") }.mapValues { (_, revisions) ->
            val ids = revisions.map { it.getString("id") }.toSet()
            val ready = ids.intersect(validIds)
            val inherited = revisions.filter { it.getString("id") in ready }.flatMap { item ->
                item.getJSONArray("parents").let { parents -> (0 until parents.length()).map { parents.getString(it) } }
            }.toSet()
            (ready - inherited) to (ids - ready)
        }
    }

    private fun collidingNotes(
        projection: Map<String, Pair<Set<String>, Set<String>>>,
        revisions: Map<String, JSONObject>,
    ): Set<String> {
        val paths = mutableMapOf<String, MutableSet<String>>()
        projection.forEach { (noteId, state) ->
            state.first.forEach { headId ->
                val revision = revisions[headId] ?: return@forEach
                if (revision.getBoolean("deleted")) return@forEach
                val metadata = revision.getJSONObject("metadata")
                if (!metadata.has("path") || metadata.get("path") !is String) return@forEach
                val key = CanonicalNotes.pathKey(metadata.getString("path"))
                paths.getOrPut(key) { mutableSetOf() }.add(noteId)
            }
        }
        return paths.values.filter { it.size > 1 }.flatten().toSet()
    }

    private fun readRow(db: SQLiteDatabase, id: String): EonLocalNote? = db.rawQuery(
        "SELECT id,title,body,revision_id,modified_at,conflict FROM notes WHERE id=? AND deleted=0", arrayOf(id)
    ).use { cursor -> if (!cursor.moveToFirst()) null else EonLocalNote(cursor.getString(0),cursor.getString(1),cursor.getString(2),cursor.getString(3),cursor.getLong(4),cursor.getInt(5)!=0) }

    private fun upsertNote(db: SQLiteDatabase, note: EonLocalNote) {
        db.execSQL("INSERT OR REPLACE INTO notes(id,title,body,revision_id,modified_at,deleted,conflict) VALUES(?,?,?,?,?,0,0)",
            arrayOf<Any>(note.id,note.title,note.body,note.revisionId,note.modifiedAt))
    }

    private fun nextSequence(db: SQLiteDatabase): Long {
        val next = db.rawQuery("SELECT value FROM meta WHERE key='next-sequence'", null).use { if (it.moveToFirst()) it.getString(0).toLong() else 1L }
        db.execSQL("INSERT OR REPLACE INTO meta(key,value) VALUES('next-sequence',?)", arrayOf((next+1).toString()))
        return next
    }

    private fun insertOperation(db: SQLiteDatabase, op: JSONObject) {
        db.execSQL("INSERT INTO operations(id,device_id,sequence,note_id,revision_id,payload) VALUES(?,?,?,?,?,?)",
            arrayOf(op.getString("id"),op.getString("deviceId"),op.getLong("sequence"),op.getJSONObject("revision").getString("noteId"),
                op.getJSONObject("revision").getString("id"),CanonicalNotes.json(op)))
    }
}
