/** Eon Notes Sync v1: transport-neutral JSON contracts shared with Android. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type NoteMetadata = Record<string, JsonValue>

export interface RevisionPayload {
  version: 1
  noteId: string
  /** Sorted unique immutable parent revision IDs; empty for initial creation. */
  parents: string[]
  deleted: boolean
  /** Null on a tombstone, exact UTF-8 text otherwise (including line endings). */
  body: string | null
  /** Null on a tombstone, complete JSON metadata otherwise. */
  metadata: NoteMetadata | null
}

export interface NoteRevision extends RevisionPayload {
  /** Lowercase 64-hex SHA-256 of the canonical RevisionPayload JSON. */
  id: string
}

export interface JournalOperation {
  version: 1
  vaultId: string
  deviceId: string
  /** Positive monotonically increasing integer; gaps allowed while offline. */
  sequence: number
  revision: NoteRevision
  /** SHA-256 of the operation's canonical fields other than id. */
  id: string
}

export interface NoteJournal {
  version: 1
  vaultId: string
  operations: JournalOperation[]
}

export interface ManifestNote {
  noteId: string
  /** Applied revision heads, including concurrent branches. */
  heads: string[]
  /** Revisions retained but waiting for ancestry from a peer. */
  pending: string[]
}

export interface SyncManifest {
  version: 1
  vaultId: string
  knownOperations: string[]
  notes: ManifestNote[]
  sha256: string
}

export interface JournalDelta {
  version: 1
  vaultId: string
  operations: JournalOperation[]
  sha256: string
}

export interface ReplayResult {
  journal: NoteJournal
  applied: string[]
  alreadySeen: string[]
  /** Missing parent IDs; retained journal entries will activate when these arrive. */
  missingParents: string[]
}

export interface TextConflict {
  field: 'body'
  reason: 'overlapping-edit' | 'merge-too-large'
  base: string
  local: string
  remote: string
}

export interface MetadataConflict {
  field: string
  reason: 'metadata-divergence'
  /** undefined means the JSON member is absent (distinct from null). */
  base?: JsonValue
  local?: JsonValue
  remote?: JsonValue
}

export interface StateConflict {
  field: 'note'
  reason: 'delete-vs-edit' | 'concurrent-create' | 'ambiguous-ancestry'
}

export type MergeConflict = TextConflict | MetadataConflict | StateConflict

export type MergeResult =
  | { status: 'merged'; deleted: boolean; body: string | null; metadata: NoteMetadata | null }
  | { status: 'conflict'; conflicts: MergeConflict[] }

export type AncestryMergeResult =
  | { status: 'up-to-date'; revision: NoteRevision }
  | { status: 'proposed'; revision: NoteRevision }
  | { status: 'conflict'; conflicts: MergeConflict[] }
