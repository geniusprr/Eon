# ADR-003: Session permissions for remote desktop

**Status:** Partially implemented; Android-to-PC remote remains unavailable. **Date:** 2026-11-11.

PC controlling Android initially launches **one managed native scrcpy window** using `scrcpy --serial SERIAL` with an exact authorised USB ADB device. Arguments are an allowlist with numeric FPS, bitrate and resolution bounds; no shell commands, wildcards or unsupervised ADB TCP/IP. The scrcpy process must be stopped on Eon exit and must show an error when the target becomes offline. Redistribution requires pinned official Genymobile archive hash and Apache-2.0 notices.

Android viewing/controlling Windows is a separate capture/input service requiring an explicit, time-limited user-approved session on the PC, with clearly visible active indicator and an always available stop control. `remote.view`, `remote.control`, `clipboard`, `power`, `files` are separate capabilities. Never assume Windows lock screen, UAC secure desktop or hidden monitors can be captured or controlled. Stop injection immediately on revoke, inactivity timeout, lock, navigation or lost identity. Monitor/rotation/DPI coordinate transforms need physical tests at 100/125/150% scaling.

Avoid exposing a general command-execution endpoint through remote permissions; only typed, schema-validated actions with per-action ACLs. Video pipeline, hardware codec and data channel should be selected on measured latency, CPU and battery costs, not architectural guesswork.
