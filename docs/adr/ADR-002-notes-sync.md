# ADR-002: Equal-authority notes sync and conflicts

**Status:** Accepted v1 contract, multi-platform proof pending. **Date:** 2026-11-11.

PC and Android are equal offline writers. Their local SQLite stores must durably record every immutable operation and monotonic per-device sequence. Identity is `vaultId` + `noteId`; title/path/timestamp are metadata only. Never use last-writer-wins to decide note content or delete a peer's edits because its clock is wrong.

See `specs/sync/PROTOCOL-v1.md` and `specs/sync/golden-v1.json` for canonical UTF-8 JSON, SHA-256, lineage, manifest/delta and merge contract. Every receiver verifies hashes and vault identity, writes a complete delta in one transaction, and ACKs only after commit. Missing ancestry is kept but not rendered as a current head. An explicit resolution creates a revision whose parents contain **all** conflicting heads. Delete/edit and rename/rename require user approval; separate-line edits may be suggested using 3-way ancestry.

Store source revisions/tombstones long enough for offline peers, and retain at least 30 days of recoverable history; garbage collection requires a peer-aware checkpoint ADR. Attachments require streaming SHA-256 chunks; a 100-MB attachment is not a request to place 100 MB inside JSON. Legacy v1 Markdown is imported only by an explicit, reversible, checksummed migrator with a dry-run inventory; never delete originals silently. Unsupported content and collisions remain visible and unresolved.

Release gates: canonical Kotlin/TS byte equivalence, two/offline/fork/concurrent creation, delete-vs-edit, reconnect/idempotency, duplicate operations, immutable parent hashes, 1/100/10k notes, unexpected process death and disk exhaustion, 100-MB attachment streaming, stable restoration and revocation.
