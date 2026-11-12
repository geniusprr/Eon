---
name: eon-architecture-guardian
description: Review Eon 2.0 architecture changes, cloud-free invariant, legacy migration and module boundaries.
---

# Eon architecture guardian

Read `docs/eon2/STATUS-20261111.md`, `docs/adr/ADR-001-transport.md`, `docs/adr/ADR-002-notes-sync.md`, and relevant code before editing. Eon 2.0 uses a Windows Electron+React UI, an explicitly owned Electron agent, and Android Kotlin/Compose. New code must have one source of authority per domain and no hidden cross-module side effects.

Enforce **USB ADB reverse or authenticated Tailscale only**. No public LAN, open relay, Supabase, ngrok, cloud queue, browser workspace or embedded AI chat in the normal Eon 2 startup. Preserve v1 data and source during migration; require dry-run/export/restore proof before removing legacy dependencies. Document any new network surface with its binding, authentication, revocation and test evidence.

Before approving a refactor, inspect callers and document public contracts; preserve the `eon-2` branch and user working-tree changes. Run focused tests, TypeScript compilation and actual app smoke. Call out unimplemented product stages rather than representing architecture decisions as deployed features.
