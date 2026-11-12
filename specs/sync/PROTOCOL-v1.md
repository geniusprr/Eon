# Eon 2.0 offline notes sync: v1 data contract

**Status:** Core library contract implemented in `packages/notes-sync`; transport, persistence, Android adapter, UI and migration integration are separate tasks. This document specifies wire JSON for **both** PC and Android; no cloud infrastructure is required. All content remains local to peers using USB ADB reverse or Tailscale transport.

## Identity, authority and storage

- `vaultId` identifies **one shared logical vault**, assigned at pairing. Each independently created vault must have a different ID. Same `vaultId` is required for every operation, manifest and delta. Never infer it from a filesystem path.
- `noteId` is a stable opaque identifier assigned once on creation. It survives renaming/moving the Markdown file. A path is note metadata (`metadata.path`), **not the sync identity**. Existing Markdown files need a durable path-to-ID migration map before sync starts; keep the original files until migration and validation succeed.
- `deviceId` is a stable per-device opaque identifier, independent of IP, transport and vault location. `sequence` is a positive JSON safe integer (1..9007199254740991), monotonically increasing **per device and vault**. Allocate and durably persist the next sequence before producing an operation. Never reuse `(deviceId, sequence)` for different content, including after reinstall or DB restore.
- The immutable per-vault operation journal is the synchronization authority; every peer may write. The derived view is built from revision ancestry. No wall-clock ordering, timestamp last-writer-wins, or PC-primary overwrite is permitted. A timestamp, when desired, is metadata for display only.
- A note revision is a full immutable snapshot: text is exact Markdown Unicode, and metadata is complete JSON. Metadata such as `path`, `title`, `tags`, `pinned` or frontmatter may be included; frontmatter contents inside Markdown body are preserved as text unless the adapters deliberately model them as metadata. Do not independently merge the same logical property in two places.
- `projectJournal` also returns `pathCollisions` when two **different** live note IDs target the same NFC/case-folded path (for example `Notes/A.md` and `notes/a.md`). Surface these collisions and block file materialisation until resolved. The Windows filesystem adapter remains responsible for its stricter on-disk collision and traversal checks.
- `deleted: true` is a **tombstone**, with `body: null` and `metadata: null`. Retain its revision and ancestors for conflict resolution. Never garbage-collect a tombstone simply because another peer is offline.

## Deterministic hashes and canonical JSON

- Every structure has `version: 1`. `revision.id = SHA256(canonicalJson(revision without id))`; `operation.id = SHA256(canonicalJson(operation without id))`, lowercase 64 hex. `manifest.sha256` and `delta.sha256` similarly hash the complete JSON object **without** its `sha256` member. These are corruption/integrity checks, **not** authentication or signatures.
- Canonical JSON has no insignificant whitespace. Sort object keys by UTF-16 code units (JavaScript default string `.sort()`, Java/Kotlin `String.compareTo`). Preserve array order. Encode text as UTF-8, with JSON string escaping matching JavaScript `JSON.stringify` (control characters, quotes, backslashes); do **not** Unicode-normalise. Reject unpaired UTF-16 surrogates and non-JSON values. Numbers are restricted to finite JSON safe integers, rendered in ordinary decimal without exponent. JSON null is distinct from an absent object member.
- Text `body` retains original line terminators (`\n`, `\r\n`) byte-for-byte after JSON UTF-8 decoding; do not let the platform's default newline conversion alter content. Paths must be validated and normalised by a separate filesystem adapter against `..`, absolute paths, duplicate/case-insensitive collisions, symlinks or illegal Windows names before touching disk.
- `specs/sync/golden-v1.json` provides literal revision/operation data and known SHA-256 outputs for canonical JSON, revision, operation, one-operation manifest and one-operation delta. Android must pass the same bytes and expected hashes independently **before** participating in synchronization.

## JSON shapes

**Revision**: `{ "version":1, "id":"<sha256>", "noteId":"<opaque>", "parents":["<sha256>"], "deleted":false, "body":"...", "metadata":{"path":"Notes/x.md"} }`. Parents are sorted and unique, possibly empty for a root. For deletion use `deleted:true`, `body:null`, `metadata:null`.

**Operation**: `{ "version":1, "id":"<sha256>", "vaultId":"<opaque>", "deviceId":"<opaque>", "sequence":7, "revision":<full revision> }`. Multiple operations may reference the same revision. Reject reused operation IDs with different bytes, or reused `(deviceId,sequence)` with a different operation. A new revision references all heads being superseded; for an ordinary edit this is usually one parent, while a resolved merge has two or more parents.

**Journal**: `{ "version":1, "vaultId":"<opaque>", "operations":[<operation>,...] }`. This is the persisted append-only data source. `replayOperations` copies, deduplicates and sorts operations by device ID then sequence, so replay order and delivery duplication do not affect state.

**Manifest**: `{ "version":1, "vaultId":"<opaque>", "knownOperations":["<opId>"], "notes":[{"noteId":"x","heads":["<revId>"],"pending":[]}], "sha256":"<sha256>" }`. Operation IDs, note IDs, heads and pending IDs are sorted uniquely. Pending revisions have missing ancestry and cannot materialise as a live note. Full known-op ID list is intentionally a simple v1 small-vault anti-entropy protocol, not an optimised production paging index.

**Delta**: `{ "version":1, "vaultId":"<opaque>", "operations":[<operation>,...], "sha256":"<sha256>" }`. Sender computes `createDelta(localJournal, remoteManifest, limit)` to send operations the peer does not claim to know. Receiver calls `applyDelta` and durably commits returned journal before acknowledging. Repeat manifest exchange and delta until both directions have no unsent operations. Truncated deltas are safe because the receiver's next manifest lists newly received IDs. Sequence gaps and unknown parents are retained in the journal for subsequent transfer; they are never silently marked successful notes.

## Merge and conflict contract

1. A receiver preserves concurrent heads and presents an explicit conflict if no automatic merge is possible. Changes are compared through graph ancestry, not timestamps. A unique maximal common ancestor enables a three-way comparison; zero or multiple maximal common ancestors require manual conflict resolution.
2. `mergeText` works on newline-preserving Markdown lines. Independent line hunks combine deterministically; same-location insertions or overlapping edits with different resulting text return conflicts. Very large quadratic diffs return `merge-too-large` rather than guessing. Identical overlapping results deduplicate.
3. Metadata compares each JSON top-level key independently. For any key changed differently by two peers, return `metadata-divergence`; distinguish missing from explicit null. For nested values (such as tags arrays or frontmatter maps), a whole-key conflict is safer than dropping changes. Rename vs rename to different paths is a `metadata.path` conflict.
4. Delete vs concurrent edit is a `delete-vs-edit` conflict; a deletion against an unchanged base remains deletion. Simultaneous independent creation of the same `noteId` is `concurrent-create`. Resolving a conflict requires the user to select/compose a complete new revision with all conflicting heads as parents; this revision must be added through a new journal operation.
5. The proposal API `proposeMerge(journal,noteId,localHead,remoteHead)` returns `up-to-date`, `proposed` or `conflict`. `proposed` is **only** a revision proposal and must be durably journalled with `createOperation`/`replayOperations` to become authoritative. UI must keep all original versions available for user conflict resolution; never write a merge automatically just because a proposal was returned.

## Transport and threat boundary

This protocol is independent of HTTP/WebSocket framing. Host applications must authenticate peers, bind a pair to the same vault, bound JSON payloads, enforce file-path sandboxing, persist operations and sequence counters atomically, then materialise only complete, conflict-free note heads. SHA-256 integrity does not replace pairing authentication. Do not remove unknown metadata, hidden files, legacy data or unresolved heads during migration. On disk write failures, retry without advancing sync acknowledgements. No public cloud endpoint or internet sync should be introduced.

### Node verification

From the repository root, run `npx --no-install tsx specs/sync/notes-sync.test.ts`. For type checking: `./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target ES2020 packages/notes-sync/index.ts` (on Windows use `node_modules\\.bin\\tsc.cmd`).
