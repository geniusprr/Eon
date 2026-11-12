import { canonicalSha256, cloneJson, requireHash, requireIdentifier } from './canonical.js'
import type { JsonValue, NoteMetadata, NoteRevision, RevisionPayload } from './types.js'

const REVISION_KEYS = ['body', 'deleted', 'id', 'metadata', 'noteId', 'parents', 'version']

export function createRevision(input: {
  noteId: string
  parents?: string[]
  deleted: boolean
  body: string | null
  metadata: NoteMetadata | null
}): NoteRevision {
  const parents = [...(input.parents ?? [])].sort()
  const payload: RevisionPayload = {
    version: 1,
    noteId: input.noteId,
    parents,
    deleted: input.deleted,
    body: input.body,
    metadata: input.metadata === null ? null : cloneJson(input.metadata),
  }
  validatePayload(payload)
  return { ...payload, id: payloadHash(payload) }
}

export function payloadHash(payload: RevisionPayload): string {
  return canonicalSha256({
    version: payload.version,
    noteId: payload.noteId,
    parents: payload.parents,
    deleted: payload.deleted,
    body: payload.body,
    metadata: payload.metadata,
  } as unknown as JsonValue)
}

function validatePayload(payload: RevisionPayload): void {
  if (payload.version !== 1) throw new Error('Unsupported revision version')
  requireIdentifier(payload.noteId, 'noteId')
  if (!Array.isArray(payload.parents)) throw new Error('Invalid revision parents')
  for (let i = 0; i < payload.parents.length; i++) {
    requireHash(payload.parents[i], 'parent revision ID')
    if (i > 0 && payload.parents[i - 1] >= payload.parents[i]) throw new Error('Parents must be sorted and unique')
  }
  if (typeof payload.deleted !== 'boolean') throw new Error('Invalid tombstone flag')
  if (payload.deleted) {
    if (payload.body !== null || payload.metadata !== null) throw new Error('Tombstones must use null body and metadata')
  } else {
    if (typeof payload.body !== 'string') throw new Error('Live revision needs text body')
    if (payload.metadata === null || typeof payload.metadata !== 'object' || Array.isArray(payload.metadata)) {
      throw new Error('Live revision needs metadata object')
    }
    canonicalSha256(payload.metadata)
  }
}

export function verifyRevision(revision: NoteRevision): void {
  if (revision === null || typeof revision !== 'object' || Array.isArray(revision)) throw new Error('Invalid revision')
  if (Object.keys(revision).sort().join(',') !== REVISION_KEYS.join(',')) throw new Error('Unexpected revision fields')
  validatePayload(revision)
  requireHash(revision.id, 'revision ID')
  if (revision.id !== payloadHash(revision)) throw new Error('Revision hash mismatch')
  if (revision.parents.includes(revision.id)) throw new Error('Revision cannot parent itself')
}
