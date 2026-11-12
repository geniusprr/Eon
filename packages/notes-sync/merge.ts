import { canonicalJson, cloneJson } from './canonical.js'
import type { JsonValue, MergeConflict, MergeResult, NoteMetadata, NoteRevision, TextConflict } from './types.js'

type Hunk = { start: number; end: number; added: string[]; source: 'local' | 'remote' }
const MAX_DIFF_CELLS = 1_500_000

function appendRange(output: string[], source: string[], from = 0, to = source.length): void {
  for (let i = from; i < to; i++) output.push(source[i])
}

function same(a: JsonValue, b: JsonValue): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function lines(body: string): string[] {
  // Preserve trailing newline and CRLF exactly; no OS-specific normalisation.
  return body.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function diff(original: string[], updated: string[], source: Hunk['source']): Hunk[] | null {
  // A long note with a small edit should not pay the quadratic cost of its
  // unchanged prefix/suffix. Preserve original line offsets in the hunks.
  let prefix = 0
  while (prefix < original.length && prefix < updated.length && original[prefix] === updated[prefix]) prefix++
  let suffix = 0
  while (suffix < original.length - prefix && suffix < updated.length - prefix &&
         original[original.length - 1 - suffix] === updated[updated.length - 1 - suffix]) suffix++
  const base = original.slice(prefix, original.length - suffix)
  const target = updated.slice(prefix, updated.length - suffix)
  const n = base.length
  const m = target.length
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null
  const stride = m + 1
  const lcs = new Uint32Array((n + 1) * stride)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * stride + j] = base[i] === target[j]
        ? lcs[(i + 1) * stride + j + 1] + 1
        : Math.max(lcs[(i + 1) * stride + j], lcs[i * stride + j + 1])
    }
  }
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let pending: Hunk | null = null
  const flush = () => { if (pending) hunks.push(pending); pending = null }
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === target[j]) {
      flush()
      i++
      j++
    } else {
      if (!pending) pending = { start: prefix + i, end: prefix + i, added: [], source }
      if (i < n && (j === m || lcs[(i + 1) * stride + j] >= lcs[i * stride + j + 1])) {
        pending.end++
        i++
      } else {
        pending.added.push(target[j])
        j++
      }
    }
  }
  flush()
  return hunks
}

function overlaps(a: Hunk, b: Hunk): boolean {
  if (a.start === a.end) {
    if (b.start === b.end) return a.start === b.start
    return a.start >= b.start && a.start < b.end
  }
  if (b.start === b.end) return b.start >= a.start && b.start < a.end
  return a.start < b.end && b.start < a.end
}

function applyGroup(base: string[], hunks: Hunk[], start: number, end: number): string[] {
  const output: string[] = []
  let cursor = start
  for (const hunk of [...hunks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    appendRange(output, base, cursor, hunk.start)
    appendRange(output, hunk.added)
    cursor = hunk.end
  }
  appendRange(output, base, cursor, end)
  return output
}

export function mergeText(baseText: string, localText: string, remoteText: string):
  | { status: 'merged'; body: string }
  | { status: 'conflict'; conflicts: TextConflict[] } {
  if (localText === remoteText) return { status: 'merged', body: localText }
  if (localText === baseText) return { status: 'merged', body: remoteText }
  if (remoteText === baseText) return { status: 'merged', body: localText }

  const original = lines(baseText)
  const local = diff(original, lines(localText), 'local')
  const remote = diff(original, lines(remoteText), 'remote')
  if (!local || !remote) {
    return { status: 'conflict', conflicts: [{ field: 'body', reason: 'merge-too-large', base: baseText, local: localText, remote: remoteText }] }
  }
  const hunks = [...local, ...remote]
  const roots = hunks.map((_, i) => i)
  const find = (index: number): number => {
    while (roots[index] !== index) index = roots[index]
    return index
  }
  for (let i = 0; i < hunks.length; i++) {
    for (let j = i + 1; j < hunks.length; j++) {
      if (hunks[i].source !== hunks[j].source && overlaps(hunks[i], hunks[j])) {
        roots[find(j)] = find(i)
      }
    }
  }
  const groups = new Map<number, Hunk[]>()
  for (let i = 0; i < hunks.length; i++) {
    const root = find(i)
    const group = groups.get(root) ?? []
    group.push(hunks[i])
    groups.set(root, group)
  }
  const sorted = [...groups.values()].map(group => ({
    start: Math.min(...group.map(h => h.start)),
    end: Math.max(...group.map(h => h.end)),
    group,
  })).sort((a, b) => a.start - b.start || a.end - b.end)

  const output: string[] = []
  const conflicts: TextConflict[] = []
  let cursor = 0
  for (const { start, end, group } of sorted) {
    appendRange(output, original, cursor, start)
    const localGroup = group.filter(h => h.source === 'local')
    const remoteGroup = group.filter(h => h.source === 'remote')
    const a = applyGroup(original, localGroup, start, end)
    const b = applyGroup(original, remoteGroup, start, end)
    if (localGroup.length && remoteGroup.length && a.join('') !== b.join('')) {
      conflicts.push({ field: 'body', reason: 'overlapping-edit', base: original.slice(start, end).join(''), local: a.join(''), remote: b.join('') })
    } else {
      appendRange(output, localGroup.length ? a : b)
    }
    cursor = end
  }
  if (conflicts.length) return { status: 'conflict', conflicts }
  appendRange(output, original, cursor)
  return { status: 'merged', body: output.join('') }
}

function mergeMetadata(base: NoteMetadata, local: NoteMetadata, remote: NoteMetadata):
  { metadata: NoteMetadata; conflicts: MergeConflict[] } {
  const metadata: NoteMetadata = {}
  const conflicts: MergeConflict[] = []
  const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort()
  for (const key of keys) {
    const present = (source: NoteMetadata) => Object.prototype.hasOwnProperty.call(source, key)
    const equal = (a: NoteMetadata, b: NoteMetadata) =>
      present(a) === present(b) && (!present(a) || same(a[key], b[key]))
    const changedLocal = !equal(base, local)
    const changedRemote = !equal(base, remote)
    if (changedLocal && changedRemote && !equal(local, remote)) {
      const conflict: MergeConflict = { field: 'metadata.' + key, reason: 'metadata-divergence' }
      if (present(base)) conflict.base = cloneJson(base[key])
      if (present(local)) conflict.local = cloneJson(local[key])
      if (present(remote)) conflict.remote = cloneJson(remote[key])
      conflicts.push(conflict)
    } else {
      const chosen = changedLocal ? local : remote
      if (present(chosen)) Object.defineProperty(metadata, key, { value: cloneJson(chosen[key]), enumerable: true, writable: true, configurable: true })
    }
  }
  return { metadata, conflicts }
}

function snapshot(revision: NoteRevision): Extract<MergeResult, { status: 'merged' }> {
  return { status: 'merged', deleted: revision.deleted, body: revision.body, metadata: revision.metadata === null ? null : cloneJson(revision.metadata) }
}

export function mergeNoteStates(base: NoteRevision | null, local: NoteRevision, remote: NoteRevision): MergeResult {
  if (local.noteId !== remote.noteId || (base && base.noteId !== local.noteId)) {
    throw new Error('Cannot merge different note IDs')
  }
  if (local.id === remote.id) return snapshot(local)
  if (!base) return { status: 'conflict', conflicts: [{ field: 'note', reason: 'concurrent-create' }] }
  if (local.id === base.id) return snapshot(remote)
  if (remote.id === base.id) return snapshot(local)
  if (local.deleted && remote.deleted) return snapshot(local)
  if (local.deleted || remote.deleted || base.deleted) {
    return { status: 'conflict', conflicts: [{ field: 'note', reason: 'delete-vs-edit' }] }
  }
  const body = mergeText(base.body!, local.body!, remote.body!)
  const fields = mergeMetadata(base.metadata!, local.metadata!, remote.metadata!)
  const conflicts = [...(body.status === 'conflict' ? body.conflicts : []), ...fields.conflicts]
  if (conflicts.length) return { status: 'conflict', conflicts }
  return { status: 'merged', deleted: false, body: body.status === 'merged' ? body.body : null, metadata: fields.metadata }
}
