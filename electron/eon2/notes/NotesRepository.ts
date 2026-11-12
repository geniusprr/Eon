import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  applyDelta, canonicalJson, createDelta, createJournal, createManifest, createOperation, createRevision,
  projectJournal, proposeMerge, replayOperations, verifyOperation, type JournalDelta,
  type JournalOperation, type MergeConflict, type NoteJournal, type NoteMetadata,
  type NoteRevision, type SyncManifest,
} from '../../../packages/notes-sync/index.js'

export interface NoteHead {
  revisionId: string
  title: string
  content: string
  deleted: boolean
  metadata: NoteMetadata | null
  parents: string[]
}

export type NotesUnresolvedReason =
  | MergeConflict
  | { field: 'note'; reason: 'concurrent-heads' | 'missing-ancestry' | 'path-collision' }

export interface NoteConflictInfo {
  noteId: string
  heads: NoteHead[]
  pending: string[]
  reasons: NotesUnresolvedReason[]
  /** Never written automatically. A user can review this proposed revision. */
  suggestedMerge?: NoteRevision
}

export interface EonNote {
  id: string
  title: string
  content: string
  path?: string
  revisionId: string
  updatedAt: number
  deleted: boolean
  /** Existing list/get callers still see the base fields; unresolved notes hold all versions in conflict. */
  unresolved?: boolean
  conflict?: NoteConflictInfo
}

export interface NoteSaveInput {
  id?: string
  title: string
  content: string
  expectedRevisionId?: string
  /** Optional portable Markdown path within the synced vault. */
  path?: string
}

export interface NotesRepositoryOptions {
  /** Supply the shared vault ID at initial pairing; otherwise an unpaired local vault ID is generated. */
  vaultId?: string
  /** Stable per-installation ID; when omitted a UUID is generated and persisted. */
  deviceId?: string
}

export interface DeltaReceiveResult {
  applied: string[]
  alreadySeen: string[]
  missingParents: string[]
  unresolved: NoteConflictInfo[]
  /** Read after COMMIT, so responding with this result acknowledges durable storage. */
  manifest: SyncManifest
}

export type ConflictResolution =
  | { deleted: true }
  | { deleted?: false; title: string; content: string; metadata?: NoteMetadata }

interface IdentityRow {
  vault_id: string
  device_id: string
  next_sequence: number
  paired: number
}

interface OperationRow { payload_json: string; recorded_at: number; revision_id: string }
interface LegacyNoteRow { id: string; title: string; content: string; revision_id: string; updated_at: number; deleted: number }
interface LegacyRevisionRow {
  revision_id: string
  note_id: string
  parent_revision_id: string | null
  title: string
  content: string
  updated_at: number
  deleted: number
}

const MAX_NOTE_SIZE = 5 * 1024 * 1024
const MAX_DELTA_SIZE = 32 * 1024 * 1024
const MAX_DELTA_OPS = 1000

export class NotesConflictError extends Error {
  constructor(message = 'Notun eşzamanlı sürümleri var veya beklenen revizyon değişti.', readonly details?: NoteConflictInfo) {
    super(message)
    this.name = 'NotesConflictError'
  }
}

/**
 * Separate Eon 2.0 SQLite authority; v1 vault files and v1 data are untouched.
 * No in-memory cached journal is used: every write derives state under a DB write lock.
 */
export class NotesRepository {
  private readonly database: DatabaseSync

  constructor(filePath: string, options: NotesRepositoryOptions = {}) {
    if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.database = new DatabaseSync(filePath)
    try {
      this.database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF;')
      if (filePath !== ':memory:') this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS sync_identity (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          vault_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          next_sequence INTEGER NOT NULL CHECK(next_sequence>0),
          paired INTEGER NOT NULL CHECK(paired IN (0,1))
        );
        CREATE TABLE IF NOT EXISTS sync_revisions (
          revision_id TEXT PRIMARY KEY NOT NULL,
          note_id TEXT NOT NULL,
          revision_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sync_revisions_by_note ON sync_revisions(note_id);
        CREATE TABLE IF NOT EXISTS sync_operations (
          operation_id TEXT PRIMARY KEY NOT NULL,
          device_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK(sequence>0),
          revision_id TEXT NOT NULL REFERENCES sync_revisions(revision_id),
          payload_json TEXT NOT NULL,
          recorded_at INTEGER NOT NULL,
          UNIQUE(device_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS sync_operations_by_revision ON sync_operations(revision_id);
        CREATE TABLE IF NOT EXISTS sync_migrations (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_legacy_revisions (
          legacy_revision_id TEXT PRIMARY KEY NOT NULL,
          revision_id TEXT NOT NULL REFERENCES sync_revisions(revision_id)
        );
      `)
      this.transaction(() => {
        this.initialiseIdentity(options)
        this.migrateEarlyPrototype()
        // A corrupted prior write must never be hidden by the newly created tables.
        projectJournal(this.readJournal())
      })
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  /** Stored pairing identity; do not regenerate when connectivity changes. */
  identity(): { vaultId: string; deviceId: string; nextSequence: number; paired: boolean } {
    const row = this.identityRow()
    return { vaultId: row.vault_id, deviceId: row.device_id, nextSequence: row.next_sequence, paired: row.paired === 1 }
  }

  /**
   * Bind an initially unpaired vault to an authenticated peer's vault ID.
   * This rewrites only local operation envelopes and is atomic. Never do this after
   * exchanging operations with peers: the paired flag blocks subsequent rebinding.
   */
  pairVault(vaultId: string): void {
    this.transaction(() => {
      const identity = this.identityRow()
      if (identity.vault_id === vaultId) {
        this.database.prepare('UPDATE sync_identity SET paired=1 WHERE singleton=1').run()
        return
      }
      // Also validates a vaultID with no local notes.
      createJournal(vaultId)
      if (identity.paired) throw new Error('Vault is already paired; cannot change vault identity')
      const journal = this.readJournal()
      if (journal.operations.some(op => op.deviceId !== identity.device_id)) {
        throw new Error('Cannot change vault ID after receiving peer operations')
      }
      const rows = this.readOperationRows()
      this.database.prepare('DELETE FROM sync_operations').run()
      this.database.prepare('UPDATE sync_identity SET vault_id=?, paired=1 WHERE singleton=1').run(vaultId)
      for (const row of rows) {
        const operation = JSON.parse(row.payload_json) as JournalOperation
        this.insertOperation(createOperation(vaultId, operation.deviceId, operation.sequence, operation.revision), row.recorded_at)
      }
      projectJournal(this.readJournal())
    })
  }

  list(): EonNote[] {
    const journal = this.readJournal()
    const state = projectJournal(journal)
    const timestamps = this.revisionTimes()
    return state.notes.map(note => this.renderNote(journal, state, timestamps, note.noteId))
      .filter((note): note is EonNote => note !== null && (!note.deleted || note.unresolved === true))
      .sort((a, b) => b.updatedAt - a.updatedAt || compare(a.id, b.id))
  }

  get(id: string): EonNote | null {
    const journal = this.readJournal()
    return this.renderNote(journal, projectJournal(journal), this.revisionTimes(), id)
  }

  history(id: string): EonNote[] {
    const journal = this.readJournal()
    const state = projectJournal(journal)
    const timestamps = this.revisionTimes()
    return [...state.revisions.values()].filter(revision => revision.noteId === id)
      .map(revision => this.asNote(revision, state.revisions, timestamps))
      .sort((a, b) => b.updatedAt - a.updatedAt || compare(b.revisionId, a.revisionId))
  }

  save(input: NoteSaveInput): EonNote {
    validateNote(input)
    return this.transaction(() => {
      const journal = this.readJournal()
      const projection = projectJournal(journal)
      const id = input.id ?? randomUUID()
      const state = projection.notes.find(note => note.noteId === id)
      const previous = input.id ? this.requireWritableHead(journal, projection, id) : undefined
      if (input.id && !previous) throw new NotesConflictError('Not bulunamadı; aynı kimlikle yeniden oluşturulamaz.')
      const expected = this.resolveLegacyAlias(input.expectedRevisionId)
      if (previous && previous.id !== expected) throw new NotesConflictError('Beklenen revizyon değişti.')
      if (!previous && expected) throw new NotesConflictError('Yeni notta revizyon önkoşulu olamaz.')
      if (!previous && state) throw new NotesConflictError('Not kimliği zaten mevcut.')
      const revision = createRevision({
        noteId: id, parents: previous ? [previous.id] : [], deleted: false,
        body: input.content, metadata: { ...(previous?.metadata ?? {}), title: input.title,
          path: input.path ?? previous?.metadata?.path ?? `Notes/${id}.md` },
      })
      this.persistLocalRevision(revision)
      const updated = projectJournal(this.readJournal())
      if (updated.pathCollisions.some(collision => collision.noteIds.includes(id))) {
        throw new NotesConflictError('Bu dosya adı başka bir not tarafından kullanılıyor. Farklı bir yol seç.')
      }
      return this.asNote(revision, projectJournal(this.readJournal()).revisions, this.revisionTimes())
    })
  }

  delete(id: string, expectedRevisionId: string): EonNote {
    return this.transaction(() => {
      const journal = this.readJournal()
      const projection = projectJournal(journal)
      const head = this.requireWritableHead(journal, projection, id)
      if (head.id !== this.resolveLegacyAlias(expectedRevisionId)) throw new NotesConflictError()
      const revision = createRevision({ noteId: id, parents: [head.id], deleted: true, body: null, metadata: null })
      this.persistLocalRevision(revision)
      return this.asNote(revision, projectJournal(this.readJournal()).revisions, this.revisionTimes())
    })
  }

  getManifest(): SyncManifest { return createManifest(this.readJournal()) }

  sendDelta(remoteManifest: SyncManifest, limit = 500): JournalDelta {
    // Mark the local vault bound once it starts sending entries to a peer.
    return this.transaction(() => {
      const delta = createDelta(this.readJournal(), remoteManifest, limit)
      this.database.prepare('UPDATE sync_identity SET paired=1 WHERE singleton=1').run()
      return delta
    })
  }

  /** No ACK is constructed until a single IMMEDIATE transaction has committed. */
  receiveDelta(delta: JournalDelta): DeltaReceiveResult {
    if (delta === null || typeof delta !== 'object' || !Array.isArray(delta.operations) ||
        delta.operations.length > MAX_DELTA_OPS || Buffer.byteLength(JSON.stringify(delta), 'utf8') > MAX_DELTA_SIZE) {
      throw new Error('Notes sync delta size or structure invalid')
    }
    const replay = this.transaction(() => {
      const current = this.readJournal()
      const result = applyDelta(current, delta)
      for (const op of delta.operations) {
        if (op.revision.body !== null && Buffer.byteLength(op.revision.body, 'utf8') > MAX_NOTE_SIZE) {
          throw new Error('Note exceeds maximum body length')
        }
      }
      const stored = new Set(current.operations.map(op => op.id))
      const localDeviceId = this.identityRow().device_id
      for (const op of delta.operations) {
        if (!stored.has(op.id)) {
          if (op.deviceId === localDeviceId) throw new Error('Remote operation cannot impersonate the local device identity')
          this.insertOperation(op, Date.now())
          stored.add(op.id)
        }
      }
      this.database.prepare('UPDATE sync_identity SET paired=1 WHERE singleton=1').run()
      // verify the persisted projection under the same write lock
      projectJournal(this.readJournal())
      return result
    })
    return {
      applied: replay.applied,
      alreadySeen: replay.alreadySeen,
      missingParents: replay.missingParents,
      unresolved: this.getConflicts(),
      manifest: this.getManifest(),
    }
  }

  getConflicts(): NoteConflictInfo[] {
    const journal = this.readJournal()
    const projection = projectJournal(journal)
    return projection.notes.map(item => this.conflictInfo(journal, projection, item.noteId))
      .filter((item): item is NoteConflictInfo => item !== null)
  }

  /** Explicit user decision: write a revision whose parents are ALL current heads. */
  resolveConflict(noteId: string, expectedHeads: string[], resolution: ConflictResolution): EonNote {
    return this.transaction(() => {
      const journal = this.readJournal()
      const projection = projectJournal(journal)
      const node = projection.notes.find(item => item.noteId === noteId)
      if (!node || node.pending.length || !node.heads.length) throw new NotesConflictError('Tamamlanmamış soy ağacı çözülmeden not yazılamaz.')
      if (!Array.isArray(expectedHeads) || expectedHeads.join(',') !== [...new Set(node.heads)].sort().join(',')) {
        throw new NotesConflictError('Çakışma başlıkları değişti; yeniden inceleyin.')
      }
      const conflict = this.conflictInfo(journal, projection, noteId)
      if (!conflict) throw new NotesConflictError('Çözümlenmemiş çakışma yok.')
      let revision: NoteRevision
      if (resolution.deleted === true) {
        revision = createRevision({ noteId, parents: node.heads, deleted: true, body: null, metadata: null })
      } else {
        validateNote(resolution)
        const metadata = resolution.metadata ?? this.sameHeadMetadata(node.heads, projection.revisions)
        if (!metadata) throw new NotesConflictError('Farklı metadata değerleri için açık metadata seçimi gerekiyor.', conflict)
        const chosenPath = metadata.path
        if (typeof chosenPath === 'string') {
          if (!isSafeRelativeNotePath(chosenPath)) throw new NotesConflictError('Not dosya yolu güvenli bir göreli Markdown yolu olmalı.', conflict)
        } else if (conflict.reasons.some(reason => reason.reason === 'path-collision')) {
          throw new NotesConflictError('Dosya yolu çakışması çözümü için yeni yol gerekli.', conflict)
        }
        revision = createRevision({ noteId, parents: node.heads, deleted: false, body: resolution.content,
          metadata: { ...metadata, title: resolution.title } })
      }
      this.persistLocalRevision(revision)
      const updatedJournal = this.readJournal()
      const latestConflict = this.conflictInfo(updatedJournal, projectJournal(updatedJournal), noteId)
      if (latestConflict?.reasons.some(reason => reason.reason === 'path-collision')) {
        throw new NotesConflictError('Yeni yol başka bir notla hâlâ çakışıyor.', latestConflict)
      }
      return this.renderNote(this.readJournal(), projectJournal(this.readJournal()), this.revisionTimes(), noteId)!
    })
  }

  close(): void { this.database.close() }

  private identityRow(): IdentityRow {
    const identity = this.database.prepare('SELECT vault_id,device_id,next_sequence,paired FROM sync_identity WHERE singleton=1').get() as unknown as IdentityRow | undefined
    if (!identity) throw new Error('Notes sync identity not initialised')
    return identity
  }

  private transaction<T>(fn: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const output = fn()
      this.database.exec('COMMIT')
      return output
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private initialiseIdentity(options: NotesRepositoryOptions): void {
    if (options.vaultId !== undefined) createJournal(options.vaultId)
    if (options.deviceId !== undefined) createJournal(options.deviceId)
    const existing = this.database.prepare('SELECT vault_id,device_id FROM sync_identity WHERE singleton=1').get() as
      { vault_id: string; device_id: string } | undefined
    if (existing) {
      if ((options.vaultId && options.vaultId !== existing.vault_id) || (options.deviceId && options.deviceId !== existing.device_id)) {
        throw new Error('Notes sync identity differs from persisted identity')
      }
    } else {
      this.database.prepare('INSERT INTO sync_identity(singleton,vault_id,device_id,next_sequence,paired) VALUES(1,?,?,1,?)')
        .run(options.vaultId ?? randomUUID(), options.deviceId ?? randomUUID(), options.vaultId ? 1 : 0)
    }
  }

  private readOperationRows(): OperationRow[] {
    return this.database.prepare('SELECT payload_json,recorded_at,revision_id FROM sync_operations ORDER BY device_id,sequence').all() as unknown as OperationRow[]
  }

  private readJournal(): NoteJournal {
    const journal = createJournal(this.identityRow().vault_id)
    journal.operations = this.readOperationRows().map(row => JSON.parse(row.payload_json) as JournalOperation)
    return journal
  }

  private revisionTimes(): Map<string, number> {
    const rows = this.database.prepare(`SELECT revision_id,MAX(recorded_at) AS timestamp FROM sync_operations GROUP BY revision_id`).all() as unknown as
      Array<{ revision_id: string; timestamp: number }>
    return new Map(rows.map(row => [row.revision_id, row.timestamp]))
  }

  private persistLocalRevision(revision: NoteRevision): void {
    const identity = this.identityRow()
    if (!Number.isSafeInteger(identity.next_sequence) || identity.next_sequence <= 0 || identity.next_sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Device operation sequence exhausted')
    }
    const operation = createOperation(identity.vault_id, identity.device_id, identity.next_sequence, revision)
    this.insertOperation(operation, Date.now())
    this.database.prepare('UPDATE sync_identity SET next_sequence=? WHERE singleton=1')
      .run(identity.next_sequence + 1)
  }

  private insertOperation(operation: JournalOperation, recordedAt: number): void {
    verifyOperation(operation)
    if (operation.vaultId !== this.identityRow().vault_id) throw new Error('Wrong vault ID')
    const revisionJSON = JSON.stringify(operation.revision)
    const prior = this.database.prepare('SELECT revision_json FROM sync_revisions WHERE revision_id=?').get(operation.revision.id) as
      { revision_json: string } | undefined
    if (prior && JSON.stringify(JSON.parse(prior.revision_json)) !== revisionJSON) {
      throw new Error('Revision content collision')
    }
    if (!prior) this.database.prepare('INSERT INTO sync_revisions(revision_id,note_id,revision_json) VALUES(?,?,?)')
      .run(operation.revision.id, operation.revision.noteId, revisionJSON)
    this.database.prepare(`INSERT INTO sync_operations(operation_id,device_id,sequence,revision_id,payload_json,recorded_at)
      VALUES(?,?,?,?,?,?)`).run(operation.id, operation.deviceId, operation.sequence, operation.revision.id,
        JSON.stringify(operation), recordedAt)
  }

  private requireWritableHead(journal: NoteJournal, state: ReturnType<typeof projectJournal>, id: string): NoteRevision {
    const item = state.notes.find(note => note.noteId === id)
    if (!item || item.heads.length !== 1 || item.pending.length || this.conflictInfo(journal, state, id)) {
      throw new NotesConflictError('Notun açık çakışması veya eksik revizyon geçmişi var.', this.conflictInfo(journal, state, id) ?? undefined)
    }
    const head = state.revisions.get(item.heads[0])!
    if (head.deleted) throw new NotesConflictError('Silinmiş not otomatik olarak diriltilemez.')
    return head
  }

  private conflictInfo(journal: NoteJournal, state: ReturnType<typeof projectJournal>, noteId: string): NoteConflictInfo | null {
    const item = state.notes.find(note => note.noteId === noteId)
    if (!item) return null
    const collisions = state.pathCollisions.filter(collision => collision.noteIds.includes(noteId))
    if (item.heads.length <= 1 && !item.pending.length && !collisions.length) return null
    const heads = item.heads.map(id => this.asHead(state.revisions.get(id)!, state.revisions))
    const reasons: NotesUnresolvedReason[] = []
    let suggestedMerge: NoteRevision | undefined
    if (item.pending.length) reasons.push({ field: 'note', reason: 'missing-ancestry' })
    if (collisions.length) reasons.push({ field: 'note', reason: 'path-collision' })
    if (item.heads.length > 1) {
      reasons.push({ field: 'note', reason: 'concurrent-heads' })
      if (item.heads.length === 2) {
        const merge = proposeMerge(journal, noteId, item.heads[0], item.heads[1])
        if (merge.status === 'conflict') reasons.push(...merge.conflicts)
        if (merge.status === 'proposed') suggestedMerge = merge.revision
      }
    }
    return { noteId, heads, pending: [...item.pending], reasons,
      ...(suggestedMerge === undefined ? {} : { suggestedMerge }) }
  }

  private renderNote(journal: NoteJournal, state: ReturnType<typeof projectJournal>, times: Map<string, number>, id: string): EonNote | null {
    const item = state.notes.find(note => note.noteId === id)
    if (!item) return null
    const conflict = this.conflictInfo(journal, state, id)
    if (conflict) {
      return { id, title: 'Çakışan not sürümleri', content: '', revisionId: '',
        updatedAt: Math.max(0, ...item.heads.map(head => times.get(head) ?? 0), ...item.pending.map(head => times.get(head) ?? 0)),
        deleted: false, unresolved: true, conflict }
    }
    if (item.heads.length !== 1) return null
    return this.asNote(state.revisions.get(item.heads[0])!, state.revisions, times)
  }

  private asHead(revision: NoteRevision, revisions: Map<string, NoteRevision>): NoteHead {
    const visible = this.visibleRevision(revision, revisions)
    return { revisionId: revision.id, title: String(visible.metadata?.title ?? '(Başlıksız)'),
      content: visible.body ?? '', deleted: revision.deleted,
      metadata: revision.metadata, parents: [...revision.parents] }
  }

  private asNote(revision: NoteRevision, revisions: Map<string, NoteRevision>, times: Map<string, number>): EonNote {
    const visible = this.visibleRevision(revision, revisions)
    return { id: revision.noteId, title: String(visible.metadata?.title ?? '(Başlıksız)'), content: visible.body ?? '',
      path: typeof visible.metadata?.path === 'string' ? visible.metadata.path : undefined,
      revisionId: revision.id, updatedAt: times.get(revision.id) ?? 0, deleted: revision.deleted }
  }

  private visibleRevision(revision: NoteRevision, revisions: Map<string, NoteRevision>): NoteRevision {
    if (!revision.deleted) return revision
    const visited = new Set<string>()
    const find = (id: string): NoteRevision | undefined => {
      if (visited.has(id)) return undefined
      visited.add(id)
      const parent = revisions.get(id)
      if (!parent) return undefined
      if (!parent.deleted) return parent
      for (const ancestor of parent.parents) {
        const prior = find(ancestor)
        if (prior) return prior
      }
      return undefined
    }
    for (const parentId of revision.parents) {
      const prior = find(parentId)
      if (prior) return prior
    }
    return revision
  }

  private sameHeadMetadata(heads: string[], revisions: Map<string, NoteRevision>): NoteMetadata | null {
    const values = heads.map(id => revisions.get(id)!.metadata)
    if (values.some(value => value === null)) return null
    const serialized = values.map(value => canonicalJson(value!))
    if (serialized.some(value => value !== serialized[0])) return null
    return values[0]
  }

  private resolveLegacyAlias(revisionId?: string): string | undefined {
    if (!revisionId) return revisionId
    const alias = this.database.prepare('SELECT revision_id FROM sync_legacy_revisions WHERE legacy_revision_id=?').get(revisionId) as
      { revision_id: string } | undefined
    return alias?.revision_id ?? revisionId
  }

  /** Early Eon2 prototype import; old notes/revisions tables remain unchanged for recovery. */
  private migrateEarlyPrototype(): void {
    const done = this.database.prepare(`SELECT value FROM sync_migrations WHERE key='early-eon2-prototype'`).get()
    if (done) return
    const tables = this.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('notes','revisions')")
      .all() as Array<{ name: string }>
    const hasNotes = tables.some(table => table.name === 'notes')
    const hasRevisions = tables.some(table => table.name === 'revisions')
    if (hasNotes !== hasRevisions) throw new Error('Early Eon 2 prototype has an incomplete schema')
    if (hasNotes) {
      const notes = this.database.prepare('SELECT * FROM notes').all() as unknown as LegacyNoteRow[]
      const revisions = this.database.prepare('SELECT * FROM revisions').all() as unknown as LegacyRevisionRow[]
      if (this.readOperationRows().length && (notes.length || revisions.length)) {
        throw new Error('Refusing to mix legacy and journal data without migration marker')
      }
      const known = new Map(revisions.map(revision => [revision.revision_id, revision]))
      const migrated = new Map<string, string>()
      const visiting = new Set<string>()
      const migrate = (oldId: string): string => {
        const earlier = migrated.get(oldId)
        if (earlier) return earlier
        const old = known.get(oldId)
        if (!old) throw new Error('Legacy parent revision is missing: ' + oldId)
        if (visiting.has(oldId)) throw new Error('Cyclic legacy revision ancestry')
        visiting.add(oldId)
        const parent = old.parent_revision_id ? [migrate(old.parent_revision_id)] : []
        visiting.delete(oldId)
        const fresh = createRevision({ noteId: old.note_id, parents: parent, deleted: old.deleted === 1,
          body: old.deleted === 1 ? null : old.content,
          metadata: old.deleted === 1 ? null : { title: old.title } })
        const identity = this.identityRow()
        const operation = createOperation(identity.vault_id, identity.device_id, identity.next_sequence, fresh)
        this.insertOperation(operation, old.updated_at)
        this.database.prepare('UPDATE sync_identity SET next_sequence=? WHERE singleton=1').run(identity.next_sequence + 1)
        this.database.prepare('INSERT INTO sync_legacy_revisions(legacy_revision_id,revision_id) VALUES(?,?)').run(oldId, fresh.id)
        migrated.set(oldId, fresh.id)
        return fresh.id
      }
      for (const old of revisions.sort((a, b) => a.updated_at - b.updated_at || compare(a.revision_id, b.revision_id))) {
        migrate(old.revision_id)
      }
      for (const old of notes) {
        if (revisions.some(revision => revision.note_id === old.id)) continue
        const baseline = createRevision({ noteId: old.id, parents: [], deleted: false,
          body: old.content, metadata: { title: old.title } })
        this.persistLocalRevision(baseline)
        if (old.deleted) this.persistLocalRevision(createRevision({ noteId: old.id, parents: [baseline.id],
          deleted: true, body: null, metadata: null }))
        this.database.prepare('INSERT INTO sync_legacy_revisions(legacy_revision_id,revision_id) VALUES(?,?)').run(old.revision_id, old.deleted ?
          createRevision({ noteId: old.id, parents: [baseline.id], deleted: true, body: null, metadata: null }).id : baseline.id)
      }
    }
    this.database.prepare(`INSERT INTO sync_migrations(key,value) VALUES('early-eon2-prototype','1')`).run()
  }
}

function validateNote(input: NoteSaveInput): void {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || typeof input.content !== 'string') {
    throw new Error('Geçersiz not verisi.')
  }
  if (input.title.length > 256 || Buffer.byteLength(input.content, 'utf8') > MAX_NOTE_SIZE) throw new Error('Not boyutu sınırı aşıldı.')
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id || input.id.length > 256)) {
    throw new Error('Geçersiz not kimliği.')
  }
  if (input.expectedRevisionId !== undefined && (typeof input.expectedRevisionId !== 'string' ||
      !/^(?:[0-9a-f]{64}|[0-9a-f-]{36})$/i.test(input.expectedRevisionId))) {
    throw new Error('Geçersiz revizyon kimliği.')
  }
  if (input.path !== undefined && (typeof input.path !== 'string' || !isSafeRelativeNotePath(input.path))) {
    throw new Error('Dosya yolu geçersiz. Markdown dosyaları güvenli göreli yollar kullanmalı.')
  }
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }

function isSafeRelativeNotePath(value: string): boolean {
  if (!value || value.length > 240 || !value.toLowerCase().endsWith('.md')) return false
  if (value.startsWith('/') || value.startsWith('\\') || /[\x00-\x1f<>:"|?*]/.test(value)) return false
  const parts = value.replace(/\\/g, '/').split('/')
  if (parts.some(segment => !segment || segment === '.' || segment === '..' || segment.endsWith(' ') || segment.endsWith('.'))) return false
  if (parts.some(segment => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) return false
  return true
}
