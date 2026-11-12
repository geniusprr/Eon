import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { canonicalSha256, createOperation, createRevision, type JournalDelta, type JsonValue } from '../../../packages/notes-sync/index.js'
import { NotesConflictError, NotesRepository } from './NotesRepository.js'

function fixture(run: (desktopPath: string, phonePath: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eon2-notes-journal-'))
  try { run(path.join(directory, 'desktop.sqlite'), path.join(directory, 'phone.sqlite')) }
  finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function exchange(from: NotesRepository, to: NotesRepository): void {
  to.receiveDelta(from.sendDelta(to.getManifest()))
}

function asDelta(vaultId: string, operations: JournalDelta['operations']): JournalDelta {
  return { version: 1, vaultId, operations, sha256: canonicalSha256({ version: 1, vaultId, operations } as unknown as JsonValue) }
}

test('existing Eon2 notes CRUD/CAS/history remains compatible, durable after reopen', () => fixture(file => {
  let store = new NotesRepository(file)
  const identity = store.identity()
  assert.equal(identity.paired, false)
  assert.equal(identity.nextSequence, 1)
  const initial = store.save({ title: 'Merhaba', content: 'A' })
  assert.match(initial.revisionId, /^[a-f0-9]{64}$/)
  const second = store.save({ id: initial.id, title: 'Merhaba', content: 'B', expectedRevisionId: initial.revisionId })
  assert.equal(store.identity().nextSequence, 3)
  assert.throws(() => store.save({ id: initial.id, title: 'Stale', content: 'Silinmesin', expectedRevisionId: initial.revisionId }), NotesConflictError)
  assert.equal(store.identity().nextSequence, 3)
  assert.deepEqual(store.history(initial.id).map(note => note.content).sort(), ['A', 'B'])
  assert.equal(store.get(initial.id)?.content, 'B')
  assert.equal(store.getManifest().knownOperations.length, 2)
  store.close()

  store = new NotesRepository(file)
  assert.deepEqual(store.identity(), { ...identity, nextSequence: 3 })
  assert.equal(store.get(initial.id)?.revisionId, second.revisionId)
  const deleted = store.delete(initial.id, second.revisionId)
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.content, 'B')
  assert.equal(store.list().length, 0)
  assert.equal(store.history(initial.id).length, 3)
  assert.equal(store.getManifest().knownOperations.length, 3)
  assert.throws(() => store.save({ id: initial.id, title: 'Restore', content: 'Unsafe', expectedRevisionId: deleted.revisionId }), NotesConflictError)
  store.close()
  store = new NotesRepository(file)
  assert.equal(store.get(initial.id)?.deleted, true)
  assert.equal(store.identity().nextSequence, 4)
  store.close()
}))

test('local journal vault ID can bind once to a peer without losing offline-created notes', () => fixture((pcPath, mobilePath) => {
  const pc = new NotesRepository(pcPath, { deviceId: 'desktop' })
  const mobile = new NotesRepository(mobilePath, { deviceId: 'android' })
  const createdOnPhone = mobile.save({ title: 'Offline', content: 'Made without connection' })
  assert.notEqual(mobile.identity().vaultId, pc.identity().vaultId)
  mobile.pairVault(pc.identity().vaultId)
  assert.equal(mobile.identity().paired, true)
  assert.equal(mobile.identity().nextSequence, 2)
  assert.equal(mobile.get(createdOnPhone.id)?.content, 'Made without connection')
  assert.throws(() => mobile.pairVault('unrelated'), /already paired/)
  exchange(mobile, pc)
  assert.equal(pc.get(createdOnPhone.id)?.content, 'Made without connection')
  assert.deepEqual(pc.getManifest(), mobile.getManifest())
  pc.close()
  mobile.close()
}))

test('concurrent PC and phone edits persist unresolved heads and only explicit resolution writes a merge', () => fixture((pcPath, mobilePath) => {
  const desktop = new NotesRepository(pcPath, { vaultId: 'shared', deviceId: 'PC' })
  let mobile = new NotesRepository(mobilePath, { vaultId: 'shared', deviceId: 'phone' })
  const root = desktop.save({ title: 'Essay', content: 'A\nB\nC\n' })
  exchange(desktop, mobile)
  const desktopEdit = desktop.save({ id: root.id, expectedRevisionId: root.revisionId, title: 'Essay', content: 'A PC\nB\nC\n' })
  const mobileEdit = mobile.save({ id: root.id, expectedRevisionId: root.revisionId, title: 'Essay', content: 'A\nB\nC phone\n' })

  exchange(desktop, mobile)
  exchange(mobile, desktop)
  const pcConflict = desktop.getConflicts()[0]
  assert.equal(pcConflict.noteId, root.id)
  assert.deepEqual(pcConflict.heads.map(head => head.revisionId).sort(), [desktopEdit.revisionId, mobileEdit.revisionId].sort())
  assert.equal(pcConflict.suggestedMerge?.body, 'A PC\nB\nC phone\n')
  assert.equal(desktop.get(root.id)?.unresolved, true)
  assert.equal(desktop.get(root.id)?.content, '')
  assert.equal(desktop.get(root.id)?.revisionId, '')
  assert.equal(desktop.list()[0].conflict?.heads.length, 2)
  assert.equal(desktop.history(root.id).length, 3)
  assert.throws(() => desktop.save({ id: root.id, expectedRevisionId: desktopEdit.revisionId, title: 'Oops', content: 'overwrite' }), NotesConflictError)
  assert.throws(() => desktop.delete(root.id, desktopEdit.revisionId), NotesConflictError)
  assert.throws(() => desktop.resolveConflict(root.id, [desktopEdit.revisionId], { title: 'Essay', content: 'wrong' }), NotesConflictError)

  mobile.close()
  mobile = new NotesRepository(mobilePath)
  assert.equal(mobile.get(root.id)?.unresolved, true)
  const resolved = desktop.resolveConflict(root.id, [...pcConflict.heads.map(h => h.revisionId)].sort(), {
    title: 'Essay', content: 'A PC\nB\nC phone\n',
  })
  assert.equal(resolved.unresolved, undefined)
  assert.equal(desktop.getConflicts().length, 0)
  exchange(desktop, mobile)
  assert.equal(mobile.get(root.id)?.content, 'A PC\nB\nC phone\n')
  assert.equal(mobile.history(root.id).length, 4)
  assert.deepEqual(desktop.getManifest(), mobile.getManifest())
  desktop.close()
  mobile.close()
}))

test('delete vs edit never discards either branch, explicit user deletion writes multi-parent tombstone', () => fixture((pcPath, mobilePath) => {
  const pc = new NotesRepository(pcPath, { vaultId: 'shared', deviceId: 'PC' })
  const phone = new NotesRepository(mobilePath, { vaultId: 'shared', deviceId: 'phone' })
  const root = pc.save({ title: 'Draft', content: 'original' })
  exchange(pc, phone)
  const deleted = pc.delete(root.id, root.revisionId)
  const changed = phone.save({ id: root.id, expectedRevisionId: root.revisionId, title: 'Draft', content: 'phone change' })
  exchange(phone, pc)
  exchange(pc, phone)
  const unresolved = pc.getConflicts()[0]
  assert(unresolved.reasons.some(reason => reason.reason === 'delete-vs-edit'))
  assert.deepEqual(unresolved.heads.map(head => head.deleted).sort(), [false, true].sort())
  assert.equal(pc.get(root.id)?.unresolved, true)
  assert.equal(pc.list().length, 1)
  assert.throws(() => pc.delete(root.id, deleted.revisionId), NotesConflictError)
  const decision = pc.resolveConflict(root.id, [deleted.revisionId, changed.revisionId].sort(), { deleted: true })
  assert.equal(decision.deleted, true)
  exchange(pc, phone)
  assert.equal(phone.get(root.id)?.deleted, true)
  assert.equal(phone.list().length, 0)
  assert.deepEqual(phone.getConflicts(), [])
  assert.equal(phone.history(root.id).length, 4)
  pc.close()
  phone.close()
}))

test('operations arriving before their ancestors remain durable/pending and activate after reconnect', () => fixture((pcPath, mobilePath) => {
  let pc = new NotesRepository(pcPath, { vaultId: 'shared', deviceId: 'PC' })
  let phone = new NotesRepository(mobilePath, { vaultId: 'shared', deviceId: 'phone' })
  const initial = pc.save({ title: 'Interrupted', content: 'base' })
  const child = pc.save({ id: initial.id, expectedRevisionId: initial.revisionId, title: 'Interrupted', content: 'new' })
  const original = pc.sendDelta(phone.getManifest())
  const early = phone.receiveDelta(asDelta('shared', [original.operations[1]]))
  assert.deepEqual(early.missingParents, [initial.revisionId])
  assert.equal(early.unresolved[0].heads.length, 0)
  assert.deepEqual(early.unresolved[0].pending, [child.revisionId])
  assert.equal(phone.list().length, 1)
  assert.equal(phone.get(initial.id)?.unresolved, true)
  phone.close()
  pc.close()

  phone = new NotesRepository(mobilePath)
  pc = new NotesRepository(pcPath)
  assert.deepEqual(phone.getManifest().notes[0].pending, [child.revisionId])
  const recovered = phone.receiveDelta(asDelta('shared', [original.operations[0]]))
  assert.deepEqual(recovered.missingParents, [])
  assert.deepEqual(phone.getConflicts(), [])
  assert.equal(phone.get(initial.id)?.content, 'new')
  const repeated = phone.receiveDelta(asDelta('shared', original.operations))
  assert.deepEqual(repeated.applied, [])
  assert.equal(repeated.alreadySeen.length, 2)
  assert.deepEqual(pc.getManifest(), phone.getManifest())
  phone.close()
  pc.close()
}))

test('SQLite write failure rolls back local operation, sequence and note atomically', () => fixture(file => {
  const repo = new NotesRepository(file, { vaultId: 'shared', deviceId: 'desktop' })
  const note = repo.save({ title: 'Atomic', content: 'before' })
  const nextSequence = repo.identity().nextSequence
  const journalBefore = repo.getManifest()
  const admin = new DatabaseSync(file)
  admin.exec("CREATE TRIGGER reject_operations BEFORE INSERT ON sync_operations BEGIN SELECT RAISE(ABORT,'test-failure'); END;")
  assert.throws(() => repo.save({ id: note.id, expectedRevisionId: note.revisionId, title: 'Atomic', content: 'after' }), /test-failure/)
  assert.equal(repo.get(note.id)?.content, 'before')
  assert.deepEqual(repo.getManifest(), journalBefore)
  assert.equal(repo.identity().nextSequence, nextSequence)
  admin.exec('DROP TRIGGER reject_operations')
  admin.close()
  const changed = repo.save({ id: note.id, expectedRevisionId: note.revisionId, title: 'Atomic', content: 'after' })
  assert.equal(repo.identity().nextSequence, nextSequence + 1)
  assert.equal(repo.get(note.id)?.revisionId, changed.revisionId)
  repo.close()
}))

test('two-operation remote delta fails atomically and can be replayed after interruption', () => fixture((pcPath, mobilePath) => {
  let desktop = new NotesRepository(pcPath, { vaultId: 'shared', deviceId: 'PC' })
  let phone = new NotesRepository(mobilePath, { vaultId: 'shared', deviceId: 'phone' })
  const root = phone.save({ title: 'Partial', content: 'one' })
  phone.save({ id: root.id, expectedRevisionId: root.revisionId, title: 'Partial', content: 'two' })
  const delta = phone.sendDelta(desktop.getManifest())
  const dbAdmin = new DatabaseSync(pcPath)
  dbAdmin.exec("CREATE TRIGGER reject_second BEFORE INSERT ON sync_operations WHEN NEW.device_id='phone' AND NEW.sequence=2 BEGIN SELECT RAISE(ABORT,'blocked-second'); END;")
  assert.throws(() => desktop.receiveDelta(delta), /blocked-second/)
  assert.equal(desktop.getManifest().knownOperations.length, 0)
  assert.equal(desktop.get(root.id), null)
  assert.equal(desktop.identity().nextSequence, 1)
  dbAdmin.exec('DROP TRIGGER reject_second')
  dbAdmin.close()
  desktop.close()
  desktop = new NotesRepository(pcPath)
  const acknowledged = desktop.receiveDelta(delta)
  assert.equal(acknowledged.applied.length, 2)
  assert.equal(acknowledged.unresolved.length, 0)
  assert.equal(desktop.get(root.id)?.content, 'two')
  phone.close()
  phone = new NotesRepository(mobilePath)
  assert.deepEqual(desktop.getManifest(), phone.getManifest())
  phone.close()
  desktop.close()
}))

test('corrupted signatures, other vaults, device sequence reuse fail without mutations', () => fixture((pcPath, mobilePath) => {
  const pc = new NotesRepository(pcPath, { vaultId: 'shared', deviceId: 'PC' })
  const phone = new NotesRepository(mobilePath, { vaultId: 'shared', deviceId: 'phone' })
  phone.save({ title: 'Source', content: 'A' })
  const delta = phone.sendDelta(pc.getManifest())
  const bad = { ...delta, sha256: '0'.repeat(64) }
  assert.throws(() => pc.receiveDelta(bad), /hash mismatch/)
  assert.equal(pc.getManifest().knownOperations.length, 0)
  assert.throws(() => pc.receiveDelta(asDelta('wrong', delta.operations)), /Wrong vault/)
  pc.receiveDelta(delta)
  const original = delta.operations[0]
  const changedRevision = createRevision({ noteId: original.revision.noteId, parents: [], deleted: false,
    body: 'different', metadata: { title: 'Source' } })
  const colliding = createOperation('shared', original.deviceId, original.sequence, changedRevision)
  assert.throws(() => pc.receiveDelta(asDelta('shared', [colliding])), /Device sequence reused/)
  assert.equal(pc.getManifest().knownOperations.length, 1)
  pc.close()
  phone.close()
}))

test('distinct IDs with same case-folded path cannot materialise and require explicit resolution', () => fixture(file => {
  const repo = new NotesRepository(file, { vaultId: 'shared', deviceId: 'PC' })
  const first = createRevision({ noteId: 'N1', parents: [], deleted: false, body: 'one', metadata: { title: 'N1', path: 'Docs/Note.md' } })
  const second = createRevision({ noteId: 'N2', parents: [], deleted: false, body: 'two', metadata: { title: 'N2', path: 'docs/note.md' } })
  const operations = [createOperation('shared', 'phone', 1, first), createOperation('shared', 'phone', 2, second)]
  repo.receiveDelta(asDelta('shared', operations))
  assert.equal(repo.getConflicts().length, 2)
  assert.equal(repo.get('N1')?.unresolved, true)
  assert.equal(repo.get('N2')?.unresolved, true)
  assert.throws(() => repo.save({ id: 'N1', title: 'N1', content: 'unsafe', expectedRevisionId: first.id }), NotesConflictError)
  const beforeResolution = repo.getManifest().knownOperations
  assert.throws(() => repo.resolveConflict('N2', [second.id], { title: 'N2', content: 'two', metadata: { path: 'docs/note.md', title: 'N2' } }), /çakışıyor/)
  assert.throws(() => repo.resolveConflict('N2', [second.id], { title: 'N2', content: 'two', metadata: { path: '../outside.md', title: 'N2' } }), /göreli Markdown/)
  assert.deepEqual(repo.getManifest().knownOperations, beforeResolution, 'failed path resolution cannot append a revision')
  const amended = repo.resolveConflict('N2', [second.id], { title: 'N2', content: 'two', metadata: { path: 'docs/other.md', title: 'N2' } })
  assert.equal(amended.unresolved, undefined)
  assert.deepEqual(repo.getConflicts(), [])
  assert.equal(repo.get('N1')?.content, 'one')
  repo.close()
}))

test('editing a remotely created note preserves unknown metadata and tags', () => fixture(file => {
  const repo = new NotesRepository(file, { vaultId: 'shared', deviceId: 'PC' })
  const remote = createRevision({ noteId: 'remote-note', parents: [], deleted: false, body: 'initial', metadata: {
    title: 'Origin', path: 'Docs/hello.md', tags: ['science', 'notes'], custom: { nested: { keep: true } },
  } })
  repo.receiveDelta(asDelta('shared', [createOperation('shared', 'phone', 1, remote)]))
  const edited = repo.save({ id: 'remote-note', expectedRevisionId: remote.id, title: 'Changed', content: 'edited here' })
  const fromDelta = repo.sendDelta(createEmptyManifest('shared')).operations
  const snapshot = fromDelta.find(op => op.revision.id === edited.revisionId)?.revision
  assert.deepEqual(snapshot?.metadata, {
    title: 'Changed', path: 'Docs/hello.md', tags: ['science', 'notes'], custom: { nested: { keep: true } },
  })
  repo.close()
}))

function createEmptyManifest(vaultId: string) {
  const remote = new NotesRepository(':memory:', { vaultId, deviceId: 'test-empty' })
  try { return remote.getManifest() } finally { remote.close() }
}

test('Markdown folder paths roundtrip, preserve metadata and reject collisions without writing', () => fixture(file => {
  const notes = new NotesRepository(file)
  const initial = notes.save({ title: 'Fikir', content: '# Merhaba', path: 'Projeler/Fikir.md' })
  assert.equal(initial.path, 'Projeler/Fikir.md')
  const moved = notes.save({ id: initial.id, expectedRevisionId: initial.revisionId,
    title: 'Fikir güncel', content: '# Merhaba\n- [ ] görev', path: 'Projeler/Yeniler/Fikir.md' })
  assert.equal(notes.get(initial.id)?.path, 'Projeler/Yeniler/Fikir.md')
  assert.equal(notes.history(initial.id).length, 2)
  const other = notes.save({ title: 'Başka', content: 'B', path: 'Projeler/Baska.md' })
  const before = notes.getManifest().knownOperations.length
  assert.throws(() => notes.save({ id: other.id, expectedRevisionId: other.revisionId,
    title: 'Çakışma', content: 'Silinmemeli', path: 'projeler/yeniler/fikir.md' }), NotesConflictError)
  assert.equal(notes.getManifest().knownOperations.length, before)
  assert.equal(notes.get(other.id)?.content, 'B')
  assert.equal(notes.get(moved.id)?.revisionId, moved.revisionId)
  assert.throws(() => notes.save({ title: 'Unsafe', content: 'x', path: '../escape.md' }), /göreli/)
  assert.equal(notes.getManifest().knownOperations.length, before)
  notes.close()
}))

test('prototype SQLite content/revision ancestry migrates transactionally without editing old tables', () => fixture(file => {
  const noteId = '11111111-1111-4111-8111-111111111111'
  const oldRoot = '22222222-2222-4222-8222-222222222222'
  const oldChild = '33333333-3333-4333-8333-333333333333'
  const oldDB = new DatabaseSync(file)
  oldDB.exec(`
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, revision_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL);
    CREATE TABLE revisions (revision_id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_revision_id TEXT,
      title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL);
  `)
  oldDB.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?)').run(noteId, 'Old title', 'new body', oldChild, 200, 0)
  oldDB.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)').run(oldRoot, noteId, null, 'Old title', 'old body', 100, 0)
  oldDB.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)').run(oldChild, noteId, oldRoot, 'Old title', 'new body', 200, 0)
  oldDB.close()

  let repo = new NotesRepository(file)
  assert.equal(repo.list().length, 1)
  assert.equal(repo.get(noteId)?.content, 'new body')
  assert.equal(repo.history(noteId).length, 2)
  assert.match(repo.get(noteId)!.revisionId, /^[0-9a-f]{64}$/)
  assert.equal(repo.identity().nextSequence, 3)
  // Old Eon 2 revision IDs from a still-open renderer are interpreted through the alias table.
  const newlyEdited = repo.save({ id: noteId, expectedRevisionId: oldChild, title: 'Old title', content: 'kept and edited' })
  repo.close()

  repo = new NotesRepository(file)
  assert.equal(repo.get(noteId)?.revisionId, newlyEdited.revisionId)
  assert.equal(repo.getManifest().knownOperations.length, 3)
  assert.equal(repo.history(noteId).length, 3)
  assert.equal(repo.identity().nextSequence, 4)
  repo.close()
  const unchangedDB = new DatabaseSync(file)
  assert.equal((unchangedDB.prepare('SELECT COUNT(*) AS value FROM notes').get() as { value: number }).value, 1)
  assert.equal((unchangedDB.prepare('SELECT COUNT(*) AS value FROM revisions').get() as { value: number }).value, 2)
  assert.equal((unchangedDB.prepare('SELECT content FROM notes').get() as { content: string }).content, 'new body')
  unchangedDB.close()
}))

test('malformed early prototype ancestry cannot partially migrate or lose its legacy rows', () => fixture(file => {
  const oldDB = new DatabaseSync(file)
  oldDB.exec(`
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, revision_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL);
    CREATE TABLE revisions (revision_id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_revision_id TEXT,
      title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL);
  `)
  oldDB.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?)').run('N', 'Title', 'data', 'rev1', 100, 0)
  oldDB.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)').run('rev1', 'N', 'missing-parent', 'Title', 'data', 100, 0)
  oldDB.close()
  assert.throws(() => new NotesRepository(file), /parent revision is missing/)
  const inspect = new DatabaseSync(file)
  assert.equal((inspect.prepare('SELECT COUNT(*) AS count FROM sync_identity').get() as { count: number }).count, 0)
  assert.equal((inspect.prepare('SELECT COUNT(*) AS count FROM sync_operations').get() as { count: number }).count, 0)
  assert.equal((inspect.prepare('SELECT COUNT(*) AS count FROM revisions').get() as { count: number }).count, 1)
  inspect.prepare('UPDATE revisions SET parent_revision_id=NULL WHERE revision_id=?').run('rev1')
  inspect.close()
  const repo = new NotesRepository(file)
  assert.equal(repo.get('N')?.content, 'data')
  repo.close()
}))
