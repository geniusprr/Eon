---
name: eon-release-qa
description: Enforce Eon 2.0 reproducible builds, critical tests, safety boundaries, mobile acceptance and rollback checks.
---

# Eon release QA

Start with `docs/eon2/STATUS-20261111.md`. Protect the dirty workspace: never `reset`, `clean`, `stash`, overwrite unrelated files, commit/push/release without task approval. Every code edit requires relevant focused tests and type checks. For Windows run `npm run build`, notes-sync/journal, ADB and scrcpy tests. Android requires Gradle lint/unit/instrumentation and physical device proof; report toolchain artifact failures as failures, never as successful builds.

Gate releases on authenticated USB/Tailscale reconnect, encrypted key storage/revoke, full notes divergence/restore/migration, controller permission matrix, scrcpy lifecycle, Android/Windows crash recovery, screenshot/accessibility and measured performance. Record exact commands, exit codes, tests and evidence timestamps in `docs/eon2`. Ship signed installer/APK and rollback only after independent review and explicit distribution instruction. Unknown hardware or unsupported OS capability is a documented limitation, never a fake success.
