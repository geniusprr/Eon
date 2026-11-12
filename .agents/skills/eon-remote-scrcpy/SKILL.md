---
name: eon-remote-scrcpy
description: Implement PC-to-Android scrcpy lifecycle and explicit Android-to-Windows remote-control permission model.
---

# Eon remote controls

Read `docs/adr/ADR-003-remote.md` and `electron/eon2/remote/ScrcpyManager.ts`. PC→Android starts **one** native scrcpy process for the validated authorised USB ADB serial with fixed argv, bounded resolution/FPS/bitrate, clean stop and error. Use pinned official scrcpy binaries, SHA-256 and Apache-2.0 notices if packaging. Do not silently enable network debugging, inject shell or reuse serials after disconnect.

Android→PC requires a separate Windows capture/encoder/input pipeline with short time-bound opt-in by the PC user. Display a continuously visible sharing indicator; revoke view/control independently; stop on lock/UAC/cancel/disconnect and map input for monitors/DPI/rotation. Never promise access to UAC secure desktop, Windows logon or sessions without OS support. Validate real latency, bitrate, hardware acceleration and security before release.
