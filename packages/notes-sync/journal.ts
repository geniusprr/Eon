import { canonicalJson, canonicalSha256, cloneJson, requireHash, requireIdentifier } from './canonical.js'
import { mergeNoteStates } from './merge.js'
import { createRevision, verifyRevision } from './revisions.js'
import type {
  AncestryMergeResult, JournalDelta, JournalOperation, JsonValue, ManifestNote,
  NoteJournal, NoteRevision, ReplayResult, SyncManifest,
} from './types.js'

const OPERATION_KEYS = ['deviceId', 'id', 'revision', 'sequence', 'vaultId', 'version']
const MANIFEST_KEYS = ['knownOperations', 'notes', 'sha256', 'vaultId', 'version']
const DELTA_KEYS = ['operations', 'sha256', 'vaultId', 'version']
const JOURNAL_KEYS = ['operations', 'vaultId', 'version']
/** Allow large notes without constructing a multi-gigabyte delta in memory. */
const MAX_DELTA_PAYLOAD_BYTES = 24 * 1024 * 1024

function requireFields(value: unknown, keys: string[], label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== keys.join(',')) {
    throw new Error('Unexpected ' + label + ' fields')
  }
}

function operationPayload(op: Omit<JournalOperation, 'id'>): JsonValue {
  return {
    version: op.version,
    vaultId: op.vaultId,
    deviceId: op.deviceId,
    sequence: op.sequence,
    revision: op.revision,
  } as unknown as JsonValue
}

function orderOperations(a: JournalOperation, b: JournalOperation): number {
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.sequence - b.sequence || a.id.localeCompare(b.id, 'en')
}

export function createJournal(vaultId: string): NoteJournal {
  requireIdentifier(vaultId, 'vaultId')
  return { version: 1, vaultId, operations: [] }
}

export function createOperation(vaultId: string, deviceId: string, sequence: number, revision: NoteRevision): JournalOperation {
  requireIdentifier(vaultId, 'vaultId')
  requireIdentifier(deviceId, 'deviceId')
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Invalid device sequence')
  verifyRevision(revision)
  const payload = {
    version: 1 as const, vaultId, deviceId, sequence,
    revision: cloneJson(revision as unknown as JsonValue) as unknown as NoteRevision,
  }
  return { ...payload, id: canonicalSha256(operationPayload(payload)) }
}

export function verifyOperation(op: JournalOperation): void {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) throw new Error('Invalid operation')
  if (Object.keys(op).sort().join(',') !== OPERATION_KEYS.join(',')) throw new Error('Unexpected operation fields')
  requireIdentifier(op.vaultId, 'vaultId')
  requireIdentifier(op.deviceId, 'deviceId')
  if (op.version !== 1) throw new Error('Unsupported operation version')
  if (!Number.isSafeInteger(op.sequence) || op.sequence <= 0) throw new Error('Invalid device sequence')
  verifyRevision(op.revision)
  requireHash(op.id, 'operation ID')
  if (op.id !== canonicalSha256(operationPayload(op))) throw new Error('Operation hash mismatch')
}

export function replayOperations(existing: NoteJournal, incoming: JournalOperation[]): ReplayResult {
  requireFields(existing, JOURNAL_KEYS, 'journal')
  if (existing.version !== 1 || !Array.isArray(existing.operations)) throw new Error('Invalid journal')
  requireIdentifier(existing.vaultId, 'vaultId')
  if (!Array.isArray(incoming)) throw new Error('Invalid incoming operations')
  const byId = new Map<string, JournalOperation>()
  const bySequence = new Map<string, string>()
  const byRevision = new Map<string, string>()
  const applied: string[] = []
  const alreadySeen: string[] = []

  const insert = (op: JournalOperation, newEntry: boolean) => {
    verifyOperation(op)
    if (op.vaultId !== existing.vaultId) throw new Error('Wrong vault ID')
    const encoded = canonicalJson(op as unknown as JsonValue)
    const old = byId.get(op.id)
    if (old) {
      if (canonicalJson(old as unknown as JsonValue) !== encoded) throw new Error('Conflicting operation ID')
      if (newEntry) alreadySeen.push(op.id)
      return
    }
    const key = op.deviceId + ':' + op.sequence
    const oldSequence = bySequence.get(key)
    if (oldSequence && oldSequence !== op.id) throw new Error('Device sequence reused for different operation')
    const prior = byRevision.get(op.revision.id)
    if (prior && prior !== op.revision.noteId) throw new Error('Revision identity collision')
    byId.set(op.id, cloneJson(op as unknown as JsonValue) as unknown as JournalOperation)
    bySequence.set(key, op.id)
    byRevision.set(op.revision.id, op.revision.noteId)
    if (newEntry) applied.push(op.id)
  }

  for (const op of existing.operations) insert(op, false)
  for (const op of incoming) insert(op, true)
  const journal: NoteJournal = { version: 1, vaultId: existing.vaultId, operations: [...byId.values()].sort(orderOperations) }
  const projection = projectJournal(journal, false)
  return { journal, applied, alreadySeen, missingParents: projection.missingParents }
}

export interface JournalProjection {
  revisions: Map<string, NoteRevision>
  notes: ManifestNote[]
  missingParents: string[]
  /** Distinct note IDs targeting the same case-insensitive path; never materialise these automatically. */
  pathCollisions: Array<{ path: string; noteIds: string[] }>
}

/** Projection preserves unresolved ancestry without making partial descendants live. */
export function projectJournal(journal: NoteJournal, validate = true): JournalProjection {
  requireFields(journal, JOURNAL_KEYS, 'journal')
  if (journal.version !== 1 || !Array.isArray(journal.operations)) throw new Error('Invalid journal')
  requireIdentifier(journal.vaultId, 'vaultId')
  const revisions = new Map<string, NoteRevision>()
  const usedSequence = new Map<string, string>()
  const usedId = new Map<string, string>()
  for (const op of journal.operations) {
    if (validate) verifyOperation(op)
    if (op.vaultId !== journal.vaultId) throw new Error('Wrong vault ID')
    const seqKey = op.deviceId + ':' + op.sequence
    if (usedSequence.has(seqKey) && usedSequence.get(seqKey) !== op.id) throw new Error('Device sequence reused')
    usedSequence.set(seqKey, op.id)
    const serialized = canonicalJson(op as unknown as JsonValue)
    if (usedId.has(op.id) && usedId.get(op.id) !== serialized) throw new Error('Operation ID reused')
    usedId.set(op.id, serialized)
    const prior = revisions.get(op.revision.id)
    if (prior && prior.noteId !== op.revision.noteId) throw new Error('Revision collision')
    revisions.set(op.revision.id, op.revision)
  }

  const validity = new Map<string, boolean>()
  const visiting = new Set<string>()
  const missing = new Set<string>()
  const resolved = (id: string): boolean => {
    const previous = validity.get(id)
    if (previous !== undefined) return previous
    const revision = revisions.get(id)
    if (!revision) { missing.add(id); return false }
    if (visiting.has(id)) throw new Error('Cyclic revision ancestry')
    visiting.add(id)
    let valid = true
    for (const parent of revision.parents) {
      const ancestor = revisions.get(parent)
      if (ancestor && ancestor.noteId !== revision.noteId) throw new Error('Cross-note revision parent')
      if (!resolved(parent)) valid = false
    }
    visiting.delete(id)
    validity.set(id, valid)
    return valid
  }
  for (const id of revisions.keys()) resolved(id)

  const nodes = new Map<string, { heads: Set<string>; pending: Set<string> }>()
  for (const [id, revision] of revisions) {
    const node = nodes.get(revision.noteId) ?? { heads: new Set<string>(), pending: new Set<string>() }
    if (validity.get(id)) node.heads.add(id)
    else node.pending.add(id)
    nodes.set(revision.noteId, node)
  }
  for (const [id, revision] of revisions) {
    if (!validity.get(id)) continue
    const node = nodes.get(revision.noteId)!
    for (const parent of revision.parents) node.heads.delete(parent)
  }
  const notes = [...nodes].map(([noteId, node]) => ({
    noteId, heads: [...node.heads].sort(), pending: [...node.pending].sort(),
  })).sort((a, b) => a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0)
  const targetPaths = new Map<string, Set<string>>()
  for (const note of notes) {
    for (const head of note.heads) {
      const revision = revisions.get(head)!
      if (revision.deleted || typeof revision.metadata?.path !== 'string') continue
      const normalized = revision.metadata.path.replace(/\\/g, '/').normalize('NFC').toLowerCase()
      const owners = targetPaths.get(normalized) ?? new Set<string>()
      owners.add(note.noteId)
      targetPaths.set(normalized, owners)
    }
  }
  const pathCollisions = [...targetPaths].filter(([, owners]) => owners.size > 1)
    .map(([path, owners]) => ({ path, noteIds: [...owners].sort() }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { revisions, notes, missingParents: [...missing].sort(), pathCollisions }
}

function manifestPayload(manifest: Omit<SyncManifest, 'sha256'>): JsonValue {
  return manifest as unknown as JsonValue
}

export function createManifest(journal: NoteJournal): SyncManifest {
  const projection = projectJournal(journal)
  const payload = {
    version: 1 as const,
    vaultId: journal.vaultId,
    knownOperations: [...new Set(journal.operations.map(op => op.id))].sort(),
    notes: projection.notes,
  }
  return { ...payload, sha256: canonicalSha256(manifestPayload(payload)) }
}

export function verifyManifest(manifest: SyncManifest): void {
  requireFields(manifest, MANIFEST_KEYS, 'manifest')
  if (manifest.version !== 1 || !Array.isArray(manifest.knownOperations) || !Array.isArray(manifest.notes)) {
    throw new Error('Invalid sync manifest')
  }
  requireIdentifier(manifest.vaultId, 'vaultId')
  requireHash(manifest.sha256, 'manifest hash')
  for (const id of manifest.knownOperations) requireHash(id, 'known operation ID')
  for (const note of manifest.notes) {
    requireFields(note, ['heads', 'noteId', 'pending'], 'manifest note')
    requireIdentifier(note.noteId, 'noteId')
    if (!Array.isArray(note.heads) || !Array.isArray(note.pending)) throw new Error('Invalid manifest heads')
    for (const hash of [...note.heads, ...note.pending]) requireHash(hash, 'revision ID')
  }
  if (canonicalSha256(manifestPayload({
    version: manifest.version, vaultId: manifest.vaultId,
    knownOperations: manifest.knownOperations, notes: manifest.notes,
  })) !== manifest.sha256) throw new Error('Manifest hash mismatch')
  if (manifest.knownOperations.join(',') !== [...new Set(manifest.knownOperations)].sort().join(',')) {
    throw new Error('Manifest known operations are not sorted/unique')
  }
  if (manifest.notes.map(n => n.noteId).join(',') !== [...new Set(manifest.notes.map(n => n.noteId))].sort().join(',')) {
    throw new Error('Manifest notes are not sorted/unique')
  }
  for (const note of manifest.notes) {
    if (note.heads.join(',') !== [...new Set(note.heads)].sort().join(',') ||
        note.pending.join(',') !== [...new Set(note.pending)].sort().join(',')) {
      throw new Error('Manifest revisions are not sorted/unique')
    }
  }
}

function deltaPayload(delta: Omit<JournalDelta, 'sha256'>): JsonValue {
  return delta as unknown as JsonValue
}

/** Stateless anti-entropy using known operation IDs, suitable for small/medium offline vaults. */
export function createDelta(journal: NoteJournal, remote: SyncManifest, limit = 500): JournalDelta {
  verifyManifest(remote)
  if (journal.vaultId !== remote.vaultId) throw new Error('Cannot sync different vaults')
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid delta limit')
  projectJournal(journal)
  const known = new Set(remote.knownOperations)
  const operations: JournalOperation[] = []
  let encodedBytes = 120
  for (const operation of journal.operations.filter(op => !known.has(op.id)).sort(orderOperations)) {
    const size = Buffer.byteLength(JSON.stringify(operation), 'utf8') + 1
    if (size > MAX_DELTA_PAYLOAD_BYTES) {
      throw new Error('A single note operation exceeds the sync transport size; the local note remains intact')
    }
    if (operations.length && encodedBytes + size > MAX_DELTA_PAYLOAD_BYTES) break
    operations.push(operation)
    encodedBytes += size
    if (operations.length >= limit) break
  }
  const payload = {
    version: 1 as const, vaultId: journal.vaultId,
    operations,
  }
  return { ...payload, sha256: canonicalSha256(deltaPayload(payload)) }
}

export function applyDelta(journal: NoteJournal, delta: JournalDelta): ReplayResult {
  requireFields(delta, DELTA_KEYS, 'delta')
  if (delta.version !== 1 || !Array.isArray(delta.operations)) throw new Error('Invalid sync delta')
  requireIdentifier(delta.vaultId, 'vaultId')
  requireHash(delta.sha256, 'delta hash')
  if (canonicalSha256(deltaPayload({ version: delta.version, vaultId: delta.vaultId, operations: delta.operations })) !== delta.sha256) {
    throw new Error('Delta hash mismatch')
  }
  if (journal.vaultId !== delta.vaultId) throw new Error('Wrong vault ID')
  return replayOperations(journal, delta.operations)
}

function ancestors(start: string, revisions: Map<string, NoteRevision>): Set<string> {
  const visited = new Set<string>()
  const walk = (id: string) => {
    if (visited.has(id)) return
    const revision = revisions.get(id)
    if (!revision) throw new Error('Unknown ancestor')
    visited.add(id)
    for (const parent of revision.parents) walk(parent)
  }
  walk(start)
  return visited
}

export function proposeMerge(journal: NoteJournal, noteId: string, localId: string, remoteId: string): AncestryMergeResult {
  const projection = projectJournal(journal)
  const node = projection.notes.find(item => item.noteId === noteId)
  if (!node || !node.heads.includes(localId) || !node.heads.includes(remoteId)) {
    throw new Error('Both revisions must be applied heads for the same note')
  }
  const local = projection.revisions.get(localId)!
  const remote = projection.revisions.get(remoteId)!
  if (localId === remoteId) return { status: 'up-to-date', revision: local }

  const left = ancestors(localId, projection.revisions)
  const right = ancestors(remoteId, projection.revisions)
  const shared = [...left].filter(id => right.has(id))
  const maximal = shared.filter(id => !shared.some(other => other !== id && ancestors(other, projection.revisions).has(id)))
  if (maximal.length !== 1) return { status: 'conflict', conflicts: [{ field: 'note', reason: 'ambiguous-ancestry' }] }

  const base = projection.revisions.get(maximal[0])!
  const merged = mergeNoteStates(base, local, remote)
  if (merged.status === 'conflict') return merged
  return { status: 'proposed', revision: createRevision({
    noteId, parents: [localId, remoteId], deleted: merged.deleted, body: merged.body, metadata: merged.metadata,
  }) }
}
