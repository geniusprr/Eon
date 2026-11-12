---
name: eon-desktop-ui
description: Build or audit modern, fast Eon 2.0 Electron React dashboard, widget editing and notes conflict screens.
---

# Eon desktop UI

Read `src/eon2`, `electron/eon2/Eon2Runtime.ts` and `docs/eon2/STATUS-20261111.md`. Design for calm, readable, genuinely fast interaction. Keep one icon system, light/dark semantic tokens, clear states, 8px spacing, resize/drag affordances, keyboard access and focus. Minimise unnecessary animation and DOM refresh; telemetric cards update at measured intervals and notes never wait on telemetry.

Do not expose Node, ADB, arbitrary shell or network directly to widgets. Every Electron IPC is allowlisted, validated and checked for the sender. Widget payloads must use typed registry IDs and bounded data. Mark incomplete adapters as unavailable. Before release do screenshot reviews at 720/900/1440/4K, 125% Windows display scaling, keyboard-only, screen reader and reduced motion, plus p95 responsiveness measurements. Compare actual behavior to accepted layouts, not subjective visual claims.
