# Desktop theme, PC actions and file transfer

Implementation date: 2026-11-11, Europe/Istanbul. This is development work, not a release acceptance claim. The workspace also contains concurrent Eon 2 source-set, notes and IPC hardening work; those changes were preserved.

## Behavior

- Desktop uses the original Eon moon/landscape wallpapers, floating narrow navigation, a large clock and readable dark panels. Obsidian, Ocean, Violet, Rose and Light use the existing `AppTheme` storage key. Polling pauses when the document is hidden; telemetry stays at a bounded two-second cadence. Notes keep their own persistence path.
- PC shortcuts can be created/edited/deleted on desktop and created/edited on Android. Types: executable with a typed argument array, an explicit PowerShell command, Windows lock, delayed shutdown/restart and cancellation. Power scheduling reuses `SystemManager`. Commands have a 30-second timeout and 64 KiB output bound. Applications spawn without a shell and do not keep a waiting child-process handle.
- A phone edit always clears per-action desktop approval. File, action and power grants are separate and expire after one hour. The action route cannot be used to bypass the power grant. Every control request passes the existing device HMAC, clock and nonce checks; grants are rechecked on every request. Initial pairing remains USB-only.
- PC files are selected with the native dialog and offered to a particular paired phone. Android chooses a destination through the Storage Access Framework. Android can also choose a document to upload to `Downloads/Eon`. Files use 256 KiB chunks, bounded base64 request payloads and an 8 GiB per-file limit. Incoming active transfers are limited to four per device and 32 GiB aggregate declared size. Receive paths are generated UUIDs, names are validated for Windows, and incomplete files are renamed only after the declared size is written and synced. Disk writes use explicit positions so a retried partially written chunk does not append duplicate bytes. Completed downloads require receiver acknowledgement.

## LocalSend scope

Reviewed primary sources: https://github.com/localsend/localsend and https://github.com/localsend/protocol (v2.2 description). The file metadata follows the LocalSend `id`, `fileName`, `size`, `fileType` shape. **This is an Eon-authenticated chunk protocol, not the complete LocalSend prepare-upload/upload API. Native LocalSend application interoperability and direct use of its implementation are NOT implemented.** No LAN multicast, unauthenticated listener, Flutter runtime or cloud relay was introduced. A full LocalSend adapter remains outstanding and must respect USB/HTTPS tailnet bindings and device consent.

## Owning files

- `src/eon2/Eon2App.tsx`, `eon2.css`, `ControlsPane.tsx`, `DevicesPane.tsx`: theme, navigation, shortcut editor, transfer queue and device grants.
- `shared/eon-controls.ts`, `shared/contracts.ts`: typed domain records and IPC channel IDs.
- `electron/eon2/agent/PcActions.ts`, `FileTransfers.ts`: bounded domain services.
- `electron/eon2/Eon2Runtime.ts`, `preload.cts`, `transport/DeviceCredentials.ts`, `transport/UsbPairingServer.ts`: native dialogs, execution, authentication and grants. The legacy preload allowlist was also extended before the separate Eon 2 preload became the owning bridge.
- `mobil/app/src/eon2/kotlin/com/kapanis/mobil/eon2/network/EonUsbClient.kt`, `ui/PcControlsScreen.kt`, `ui/Eon2Screen.kt`: Android client, document pickers and controls navigation. Android files moved into this source set during concurrent work.
- `electron/eon2/agent/Controls.test.ts`, `transport/UsbPairingServer.test.ts`, `controls-smoke.cjs`: domain, protocol and Electron checks.

## Verification

- `npm run build`: passed (React/Vite and Electron TypeScript). A test-only TypeScript narrowing error found during development was corrected.
- `npx --no-install tsx electron/eon2/agent/Controls.test.ts`: 2/2 passed. Approval invalidation and persistence; invalid executables/arguments; byte-for-byte upload/download; device isolation; duplicate/out-of-order chunks; zero-byte files; traversal/reserved names; cancellation.
- `npx --no-install tsx electron/eon2/transport/UsbPairingServer.test.ts`: 2/2 passed. Pairing/replay/revocation plus file/action/power permission separation, method confusion and altered signed bodies.
- `npx --no-install tsx specs/sync/notes-sync.test.ts`: 12/12 passed.
- `npx --no-install tsx electron/eon2/notes/NotesRepository.test.ts`: 12/12 passed.
- ADB parser, Tailscale parser/DNS/IP validation and scrcpy argument tests passed separately.
- `electron/eon2/controls-smoke.cjs` launched a real Electron runtime with an isolated profile. Checked renderer allowlist rejection, shortcut persistence, modal input focus/Escape, five-theme switching, and screenshots at requested widths 720/900/1440/3840. Windows enforced 722 logical pixels for the smallest window. No root horizontal overflow was observed. See `qa-controls/smoke.json` and PNGs. The local 30-navigation sample measured p95 15.5 ms from click to two animation frames; this is not an end-to-end latency, hardware or battery benchmark.
- Android `:app:assembleDebug :app:lintDebug` passed with local Android SDK and Studio JBR 21 explicitly selected. Plain Gradle initially attempted a blocked JDK download; an offline attempt without SDK location also failed. Successful invocation used `ANDROID_HOME=C:/Users/Deha/AppData/Local/Android/Sdk` and `-Dorg.gradle.java.installations.paths=C:/Program Files/Android/Android Studio/jbr`, `--offline --max-workers=2`.
- Android `:app:testDebugUnitTest` failed to compile the existing `RemoteCoordinateMapperTest`: its legacy data classes are excluded by the new Eon 2 source set. Tests were not deleted, filtered or represented as passing.
- Debug APK installed with `adb install -r` on USB-authorised Vivo V2205, package `com.kapanis.mobil.eon2.dev`. The original app package was not overwritten. App launch and Controls → PC shortcuts navigation were observed, with no AndroidRuntime crash in the sampled log.

## Remaining acceptance

The desktop process already running on port 8768 was an older build: its action endpoint returned HTTP 404 on the phone. The isolated Electron smoke therefore reports that its USB listener could not bind; its desktop/IPC checks still ran, but it is NOT a physical USB transfer test. The phone now gives an explicit desktop-version message for this case.

Restart Eon with the current build before testing physical transfer in both directions, approving phone edits on PC and executing a harmless command. Windows lock/shutdown/restart were not executed during verification. Live Tailscale HTTPS transfer, VPN loss/reconnect, full-file interruption/resume, process-crash recovery, full-size throughput, screen-reader acceptance and mobile font scaling remain unverified. Transfer queue state is currently process-local; after restart a new offer is required and interrupted `.part` files from an abrupt crash may need cleanup. Native LocalSend integration remains outstanding as described above.

No commit, push, deployment, production install or release was performed.

## 14 Kasım 2026 · Mobil Kısayollar

- Dikey Kontrol ekranının yerini Kısayollar sekmesi aldı. Kayıtlı komutlar ve Windows araçları aynı ekranda aranıp çalıştırılabiliyor. Kısayol ekleme ve düzenleme mevcut PC deposunu, dikey ve yatay ekranlar aynı komut ve izin modelini kullanıyor. PC ekranına Ayarlar üzerinden, medya denetimlerine yatay Deck üzerinden erişiliyor.
- Android debug APK, lint ve 15 birim testi geçti. Komut Windows yol kodlaması nedeniyle Android projesi `Q:` üzerinden eşlendikten sonra çalıştırıldı. Görevler `:app:assembleDebug :app:lintDebug :app:testDebugUnitTest`, çıkış 0. AndroidTest paketi derlendi. Projede bu pakette çalıştırılacak test kaynağı bulunmuyor.
- Windows `npm run build` ve `npm run test:eon2` çıkış 0, 115 test geçti. İzole Electron Deck önizleme testi de çıkış 0. Testin USB dinleyicisi mevcut Eon süreci portu kullandığından devreye girmedi.
- Vivo V2205, Android 14 üzerinde debug APK ve gerçek USB kısayol listesi, koyu tema, PC ekranına girip geri dönme, Local Send sekmesi ve iki yönlü Deck dönüşü doğrulandı. Android 15 emülatöründe açık tema, yüzde 200 yazı boyutu, arama, form doğrulaması, Windows bağlantısı (.lnk) oluşturma ve düzenleme, izin kaybı ve yükleme hatasından toparlanma doğrulandı. Komut yürütme ve zamanlı başlatma/iptal çağrıları izole PC sürecinde simüle edildi.
- TalkBack, Tailscale ve gerçek güç komutu yürütme doğrulanmadı.
