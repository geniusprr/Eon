import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  applyDelta, canonicalJson, canonicalSha256, createDelta, createJournal, createManifest,
  createOperation, createRevision, mergeNoteStates, mergeText, projectJournal,
  proposeMerge, replayOperations, verifyManifest, verifyOperation, verifyRevision,
} from '../../packages/notes-sync/index'
import type { JournalOperation, JsonValue, NoteJournal, NoteRevision, SyncManifest } from '../../packages/notes-sync/index'

const golden = JSON.parse(readFileSync(new URL('./golden-v1.json', import.meta.url), 'utf8')) as {
  version: number
  canonical: string
  canonicalSha256: string
  manifestSha256: string
  deltaSha256: string
  revision: NoteRevision
  operation: JournalOperation
}

function live(body: string, parents: string[] = [], metadata: Record<string, JsonValue> = { path: 'hello.md' }, noteId = 'N'): NoteRevision {
  return createRevision({ noteId, parents, deleted: false, body, metadata })
}

function tombstone(parents: string[], noteId = 'N'): NoteRevision {
  return createRevision({ noteId, parents, deleted: true, body: null, metadata: null })
}

function append(journal: NoteJournal, deviceId: string, sequence: number, revision: NoteRevision): NoteJournal {
  return replayOperations(journal, [createOperation(journal.vaultId, deviceId, sequence, revision)]).journal
}

test('stable canonical and SHA256 golden JSON match Android fixture (Unicode, CRLF, key ordering)', () => {
  assert.equal(golden.version, 1)
  assert.equal(canonicalJson({ z: 1, a: ['é', 'x\n'] }), golden.canonical)
  assert.equal(canonicalSha256({ a: ['é', 'x\n'], z: 1 }), golden.canonicalSha256)
  verifyRevision(golden.revision)
  verifyOperation(golden.operation)
  assert.equal(createRevision({
    noteId: golden.revision.noteId,
    parents: golden.revision.parents,
    deleted: golden.revision.deleted,
    body: golden.revision.body,
    metadata: golden.revision.metadata,
  }).id, golden.revision.id)
  assert.equal(createOperation('vault-01', 'android-1', 1, golden.revision).id, golden.operation.id)
  assert.equal(canonicalSha256(golden.revision.metadata!), canonicalSha256({ tags: ['alpha', 'β'], path: 'Projeler/İş.md' }))
  const journal = replayOperations(createJournal('vault-01'), [golden.operation]).journal
  assert.equal(createManifest(journal).sha256, golden.manifestSha256)
  assert.equal(createDelta(journal, createManifest(createJournal('vault-01'))).sha256, golden.deltaSha256)
})

test('invalid hashes, unexpected fields, unsafe values and broken surrogates fail closed', () => {
  assert.throws(() => canonicalJson({ n: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/)
  assert.throws(() => canonicalJson('bad\uD800'), /surrogate/)
  assert.throws(() => canonicalJson({ f: undefined } as unknown as JsonValue), /Invalid JSON/)
  assert.throws(() => createRevision({ noteId: 'x', parents: [], deleted: true, body: 'not gone', metadata: null }), /Tombstones/)
  assert.throws(() => createRevision({ noteId: 'x', parents: [golden.revision.id, golden.revision.id], deleted: false, body: '', metadata: {} }), /sorted and unique/)
  assert.throws(() => verifyRevision({ ...golden.revision, body: 'tampered' }), /hash mismatch/)
  assert.throws(() => verifyOperation({ ...golden.operation, sequence: 2 }), /hash mismatch/)
  assert.throws(() => verifyOperation({ ...golden.operation, extra: 1 } as unknown as JournalOperation), /Unexpected operation fields/)
})

test('text merge combines separate modifications without changing CRLF, or guessing concurrent insertions', () => {
  const base = 'A\r\nB\r\nC\r\n'
  assert.deepEqual(mergeText(base, 'A changed\r\nB\r\nC\r\n', 'A\r\nB\r\nC changed\r\n'), {
    status: 'merged', body: 'A changed\r\nB\r\nC changed\r\n',
  })
  assert.deepEqual(mergeText(base, 'A\r\nB\r\nC\r\nX\r\n', 'A\r\nB\r\nC\r\nX\r\n'), {
    status: 'merged', body: 'A\r\nB\r\nC\r\nX\r\n',
  })
  const insertConflict = mergeText(base, base + 'local\n', base + 'remote\n')
  assert.equal(insertConflict.status, 'conflict')
  if (insertConflict.status === 'conflict') assert.equal(insertConflict.conflicts[0].reason, 'overlapping-edit')
  const overlapping = mergeText(base, 'local\r\nB\r\nC\r\n', 'remote\r\nB\r\nC\r\n')
  assert.equal(overlapping.status, 'conflict')
  const long = Array.from({ length: 3000 }, (_, index) => 'line ' + index + '\n')
  assert.deepEqual(mergeText(long.join(''), ['changed first\n', ...long.slice(1)].join(''),
    [...long.slice(0, -1), 'changed last\n'].join('')), {
    status: 'merged', body: ['changed first\n', ...long.slice(1, -1), 'changed last\n'].join(''),
  })
  assert.equal(mergeText('x\n'.repeat(2000), 'y\n'.repeat(2000), 'z\n'.repeat(2000)).status, 'conflict')
})

test('independent edits commute across 100 generated line-pairs', () => {
  for (let a = 0; a < 10; a++) {
    for (let b = 10; b < 20; b++) {
      const base = Array.from({ length: 20 }, (_, i) => 'line:' + i + '\n')
      const local = [...base]
      const remote = [...base]
      local[a] = 'local:' + a + '\n'
      remote[b] = 'remote:' + b + '\n'
      const expected = [...base]
      expected[a] = local[a]
      expected[b] = remote[b]
      assert.deepEqual(mergeText(base.join(''), local.join(''), remote.join('')), { status: 'merged', body: expected.join('') })
    }
  }
})

test('3-way note merge keeps independent text/metadata edits, flags conflicting path, tags and delete', () => {
  const base = live('one\ntwo\n', [], { path: 'original.md', tags: ['base'], priority: null })
  const a = live('ONE\ntwo\n', [base.id], { path: 'original.md', tags: ['base'], priority: null })
  const b = live('one\nTWO\n', [base.id], { path: 'renamed.md', tags: ['base'], priority: null })
  const result = mergeNoteStates(base, a, b)
  assert.deepEqual(result, { status: 'merged', deleted: false, body: 'ONE\nTWO\n', metadata: { path: 'renamed.md', priority: null, tags: ['base'] } })

  const c = live('one\ntwo\n', [base.id], { path: 'one.md', tags: ['left'] })
  const d = live('one\ntwo\n', [base.id], { path: 'two.md', tags: ['right'] })
  const metadataConflict = mergeNoteStates(base, c, d)
  assert.equal(metadataConflict.status, 'conflict')
  if (metadataConflict.status === 'conflict') {
    assert.deepEqual(metadataConflict.conflicts.map(x => x.field), ['metadata.path', 'metadata.tags'])
  }

  const removed = tombstone([base.id])
  assert.deepEqual(mergeNoteStates(base, removed, base), { status: 'merged', deleted: true, body: null, metadata: null })
  const editDelete = mergeNoteStates(base, removed, a)
  assert.deepEqual(editDelete, { status: 'conflict', conflicts: [{ field: 'note', reason: 'delete-vs-edit' }] })
  assert.deepEqual(mergeNoteStates(null, live('a'), live('b')), { status: 'conflict', conflicts: [{ field: 'note', reason: 'concurrent-create' }] })
})

test('different metadata key removal vs null is a conflict and reserved key is data', () => {
  const meta = JSON.parse('{"path":"a.md","x":1,"__proto__":{"value":"safe"}}') as Record<string, JsonValue>
  const base = live('A', [], meta)
  const local = live('A', [base.id], { path: 'a.md', x: null, ...JSON.parse('{"__proto__":{"value":"safe"}}') })
  const remote = live('A', [base.id], { path: 'a.md', ...JSON.parse('{"__proto__":{"value":"safe"}}') })
  const result = mergeNoteStates(base, local, remote)
  assert.equal(result.status, 'conflict')
  if (result.status === 'conflict') assert.deepEqual(result.conflicts.map(x => x.field), ['metadata.x'])
  assert.equal(({} as Record<string, unknown>).value, undefined)
})

test('idempotent replay preserves out-of-order missing ancestry and converges independent of delivery order', () => {
  const parent = live('base\n')
  const left = live('left\n', [parent.id])
  const right = live('right\n', [parent.id])
  const ops = [
    createOperation('vault-01', 'desktop', 1, parent),
    createOperation('vault-01', 'desktop', 2, left),
    createOperation('vault-01', 'mobile', 1, right),
  ]
  const early = replayOperations(createJournal('vault-01'), [ops[1], ops[2]])
  assert.deepEqual(early.missingParents, [parent.id])
  assert.deepEqual(projectJournal(early.journal).notes, [{ noteId: 'N', heads: [], pending: [left.id, right.id].sort() }])

  const all = replayOperations(early.journal, [ops[0], ...ops])
  assert.equal(all.applied.length, 1)
  assert.equal(all.alreadySeen.length, 3)
  assert.deepEqual(all.missingParents, [])
  const otherOrder = replayOperations(createJournal('vault-01'), [ops[2], ops[0], ops[1]])
  assert.deepEqual(all.journal, otherOrder.journal)
  assert.deepEqual(createManifest(all.journal).notes, [{ noteId: 'N', heads: [left.id, right.id].sort(), pending: [] }])
  assert.deepEqual(replayOperations(all.journal, [...ops, ...ops]).journal, all.journal)
})

test('manifest/delta roundtrips, pagination and repeat delivery preserve all branches', () => {
  const first = live('one\n')
  const second = live('two\n', [first.id])
  const third = live('three\n', [first.id])
  let desktop = createJournal('shared')
  desktop = append(desktop, 'PC', 1, first)
  desktop = append(desktop, 'PC', 2, second)
  desktop = append(desktop, 'Phone', 1, third)
  let phone = createJournal('shared')
  for (let round = 0; round < 3; round++) {
    const delta = createDelta(desktop, createManifest(phone), 1)
    assert.equal(delta.operations.length, 1)
    phone = applyDelta(phone, delta).journal
    assert.deepEqual(applyDelta(phone, delta).journal, phone)
  }
  assert.equal(createDelta(desktop, createManifest(phone)).operations.length, 0)
  assert.deepEqual(createManifest(desktop), createManifest(phone))
  assert.deepEqual(createManifest(phone).notes[0].heads, [second.id, third.id].sort())
  const damaged = createDelta(desktop, createManifest(createJournal('shared')))
  damaged.operations[0].sequence += 1
  assert.throws(() => applyDelta(createJournal('shared'), damaged), /hash mismatch/)
  assert.throws(() => createDelta(desktop, createManifest(createJournal('other'))), /different vaults/)
  const malformed: SyncManifest = { ...createManifest(phone), knownOperations: [] }
  assert.throws(() => verifyManifest(malformed), /hash mismatch/)
  assert.throws(() => verifyManifest({ ...createManifest(phone), extra: true } as unknown as SyncManifest), /Unexpected manifest fields/)
})

test('replay rejects conflicting device sequence, forged operations and cross-note ancestry', () => {
  const base = live('base')
  const first = createOperation('shared', 'PC', 1, base)
  const other = createOperation('shared', 'PC', 1, live('different'))
  assert.throws(() => replayOperations(createJournal('shared'), [first, other]), /Device sequence reused/)
  assert.throws(() => replayOperations(createJournal('other'), [first]), /Wrong vault/)
  assert.throws(() => replayOperations(createJournal('shared'), [{ ...first, id: '0'.repeat(64) }]), /hash mismatch/)
  const otherNote = live('else', [base.id], { path: 'other.md' }, 'different-note')
  assert.throws(() => replayOperations(createJournal('shared'), [first, createOperation('shared', 'Phone', 1, otherNote)]), /Cross-note/)
  const sameRevisionDifferentDevice = createOperation('shared', 'Phone', 1, base)
  assert.deepEqual(projectJournal(replayOperations(createJournal('shared'), [first, sameRevisionDifferentDevice]).journal).notes[0].heads, [base.id])
})

test('two distinct note IDs targeting the same Windows path are explicitly flagged', () => {
  const first = live('data 1', [], { path: 'Projeler/Note.md' }, 'first')
  const second = live('data 2', [], { path: 'projeler/note.md' }, 'second')
  let journal = append(createJournal('shared'), 'PC', 1, first)
  journal = append(journal, 'Phone', 1, second)
  assert.deepEqual(projectJournal(journal).pathCollisions, [{ path: 'projeler/note.md', noteIds: ['first', 'second'] }])
  assert.equal(projectJournal(journal).notes.length, 2)
})

test('merge proposal uses unique common ancestor and becomes a single head only after journalling', () => {
  const base = live('a\nb\nc\n')
  const a = live('A\nb\nc\n', [base.id])
  const b = live('a\nb\nC\n', [base.id])
  let journal = createJournal('shared')
  journal = append(journal, 'PC', 1, base)
  journal = append(journal, 'PC', 2, a)
  journal = append(journal, 'Phone', 1, b)
  const proposal = proposeMerge(journal, 'N', a.id, b.id)
  assert.equal(proposal.status, 'proposed')
  if (proposal.status !== 'proposed') return
  assert.deepEqual(proposal.revision.parents, [a.id, b.id].sort())
  assert.equal(proposal.revision.body, 'A\nb\nC\n')
  assert.deepEqual(projectJournal(journal).notes[0].heads, [a.id, b.id].sort())
  journal = append(journal, 'PC', 3, proposal.revision)
  assert.deepEqual(createManifest(journal).notes[0].heads, [proposal.revision.id])
  assert.equal(proposeMerge(journal, 'N', proposal.revision.id, proposal.revision.id).status, 'up-to-date')
  assert.throws(() => proposeMerge(journal, 'N', base.id, proposal.revision.id), /heads/)
})

test('multiple best common ancestors fail closed instead of picking a base arbitrarily', () => {
  const root = live('a\nb\n')
  const a = live('A\nb\n', [root.id])
  const b = live('a\nB\n', [root.id])
  const x = live('A\nB\n', [a.id, b.id])
  const y = live('A\nBB\n', [a.id, b.id])
  let journal = createJournal('shared')
  for (const [i, revision] of [root, a, b, x, y].entries()) journal = append(journal, 'PC', i + 1, revision)
  assert.deepEqual(proposeMerge(journal, 'N', x.id, y.id), {
    status: 'conflict', conflicts: [{ field: 'note', reason: 'ambiguous-ancestry' }],
  })
})
