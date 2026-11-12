---
name: eon-notes-sync
description: Build and verify durable cross-device Markdown note journals, conflict UI and lossless Eon Notes migration.
---

# Eon Notes sync

Read `docs/adr/ADR-002-notes-sync.md` and `specs/sync/PROTOCOL-v1.md`. `packages/notes-sync` is canonical for operation identity, canonical JSON and merge semantics; Android must pass the literal `specs/sync/golden-v1.json` hashes. Notes have equal authority on both devices and cannot be reconciled by wall clock or path.

All edits must atomically persist content-addressed revisions, op journal and local monotonic sequence. A receiving peer commits before ACK and deduplicates after reconnect. Missing ancestry, same-block edits, delete/edit, rename conflicts and path collisions must leave every head recoverable. Proposed automatic 3-way merge is not committed without explicit policy/user decision. Keep tombstones ≥30 days, subject to peer-aware GC. For migrations first inventory/export and verify hashes; preserve original Markdown files and metadata.

Testing: offline forks with distinct/same lines, wrong clocks, duplicate/out-of-order ops, disk full, killed writer, new/revoked device, 10k notes, large text and binary streaming. Never write a shared path from two concurrent heads without user resolution.
