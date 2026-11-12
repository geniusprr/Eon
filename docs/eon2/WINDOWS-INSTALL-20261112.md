# Windows local installation QA — 12 November 2026

## Scope and fixes

User requested a release build installed on this PC, with working icons. Existing dirty-workspace changes were preserved. This is a local Windows installation, not a public release or a claim that every production gate in STATUS-20261111.md is satisfied.

- `electron/main.ts`: set Windows AppUserModelID to `com.kapanis.desktop`, matching NSIS shortcuts.
- `electron/eon2/preload.cts`: allow the five existing, validated transfer-directory and completed-file handlers. The installed renderer previously showed `Eon 2 IPC capability denied` and could not load the receive directory.
- `electron/eon2/preload.test.ts`: exercise transfer bridge forwarding and ensure legacy execution/browser capabilities remain denied.

## Build and checks

- `npm run build`: exit 0; TypeScript renderer/main checks and Vite production build. Vite reports the existing large-chunk warning.
- `npx --no-install tsx --test specs/sync/notes-sync.test.ts electron/eon2/notes/NotesRepository.test.ts electron/eon2/transport/AdbService.test.ts electron/eon2/transport/UsbPairingServer.test.ts electron/eon2/transport/TailscaleDetector.test.ts electron/eon2/remote/ScrcpyManager.test.ts electron/eon2/agent/Controls.test.ts electron/eon2/deck/DeckLayoutStore.test.ts src/eon2/deckMirrorLayout.test.ts electron/eon2/agent/SystemTelemetry.test.ts electron/eon2/agent/WindowsDeckTelemetry.test.ts electron/eon2/preload.test.ts electron/eon2/remote/ScrcpyPresentation.test.mjs`: exit 0, **67/67**. Log: `qa-release-20261112/tests.log`.
- `node build/stage-mobile.mjs --offline --max-workers=2 "-Dorg.gradle.java.installations.paths=C:/Program Files/Android/Android Studio/jbr"`: exit 0 with `ANDROID_HOME=C:/Users/Deha/AppData/Local/Android/Sdk` and Android Studio JBR selected. The latest run recovered from a Kotlin incremental-daemon cache error through Gradle's non-daemon fallback and completed `assembleDebug`. The bundled companion remains the isolated development package `com.kapanis.mobil.eon2.dev`; it is not a signed Android production release.
- `node build/stage-scrcpy.mjs`: exit 0; complete 11-file scrcpy distribution staged.
- Deck Electron smoke: exit 0, refreshed at 03:50 Istanbul time; 722/900/1440/1920/3840 logical widths, no horizontal overflow, overlap or out-of-bounds cards; light theme, keyboard resize, pointer drag, persistence and navigation passed. Original smoke copied to a temporary directory solely to redirect output and preserve earlier evidence. Results/screenshots: `qa-release-20261112/deck/`. Its isolated USB listener could not bind because the real Eon process owned port 8768; this test is not USB acceptance.
- Initial `npm run dist` stopped because ANDROID_HOME was unset. The explicit staging commands above corrected the environment; no packaging step was skipped.
- Historical controls smoke failed at its obsolete `.eon-studio` assertion after that UI had been replaced by DeckMirror. It is not reported as passing; the current Deck smoke and installed-app checks cover the current shell.

## Installed-app observations

The first installer completed with exit 0. Installed `resources/app.asar` matched the packaged archive by SHA-256. Both Desktop and Start-menu shortcuts target `C:/Users/Deha/AppData/Local/Programs/Eon/Eon.exe`, use `Eon.exe,0`, and carry `com.kapanis.desktop`. The executable's extracted icon was visually inspected (`qa-release-20261112/packaged-exe-icon.png`).

The actual installed Eon process was observed loading `file:///C:/Users/Deha/AppData/Local/Programs/Eon/resources/app.asar/dist/index.html`, with 125% display scaling. Dashboard, Notes, shortcuts, Devices, Transfers and Settings were opened. Existing note, two Deck screens, four shortcuts and paired Vivo persisted. The initial Transfers check found the bridge defect described above; final reinstallation verification is recorded below.

The installed process owned the loopback USB listener. Bundled `resources/scrcpy/scrcpy.exe` was observed as its child. An authorised Vivo V2205 showed real video embedded and in an external window. The test session was ended. PiP was not accepted as verified. No power actions or personal file transfers were executed, and device permissions were not changed.

## Rollback and limitations

Previous installation: `builds/rollback-windows-20261112/Eon`. Eon 2 data snapshot: `builds/rollback-windows-20261112/eon-2-data`. Original application data was retained.

The installer/executable has no Authenticode signature. Full Windows reboot/autostart, screen-reader, sustained performance, bidirectional physical file transfer, USB unplug/replug and tailnet outage recovery were not accepted in this run. A responsive visible window and passing focused checks do not establish defect-free operation across all workflows.
