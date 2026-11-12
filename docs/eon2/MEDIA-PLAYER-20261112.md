# Media player — 2026-11-12

The desktop Deck mirror and Dashboard Studio now share one player. The Android landscape Deck and portrait control overview share a native Compose player. Artwork, track metadata, primary playback controls and secondary system-volume controls have separate visual roles. Ambilight comes from the actual cover: a clipped blurred image on desktop and sampled radial colour fields on Android. No dependency was added.

Previously the Eon 2 Windows adapter exposed only title, artist and playing status. It now reads the session thumbnail, bounds the source to 2 MiB, downsizes to 320 pixels, re-encodes to JPEG and caps the resulting data at 128 KiB. Validation accepts bounded local JPEG/PNG data only. Existing IPC/USB permission gates remain in place. Missing artwork falls back to a music icon without inventing a cover. No unsupported seek, shuffle or repeat controls were added.

Design references, consulted with the `eon-desktop-ui`, `frontend-design` and `eon-android-compose` skills:

- [Spotify Now Playing](https://support.spotify.com/ga-en/article/now-playing/)
- [Apple Music MiniPlayer](https://support.apple.com/en-euro/guide/music/mus71d7dcfce/mac)
- [Windows media properties and thumbnail](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmediaproperties)
- [Windows stream interfaces](https://learn.microsoft.com/en-us/uwp/api/windows.storage.streams.irandomaccessstream)

## Changed files

- `src/eon2/MediaPlayer.tsx`, `media-player.css`: shared accessible player and card size queries.
- `src/eon2/DeckMirror.tsx`, `DashboardStudio.tsx`: integration and shared media type.
- `src/eon2/deck-mirror.css`, `dashboard-studio.css`: removed replaced player styles.
- `shared/eon-deck-telemetry.ts`: optional bounded artwork field.
- `electron/eon2/agent/WindowsDeckTelemetry.ts`: native thumbnail extraction and validation.
- `electron/eon2/agent/WindowsDeckTelemetry.test.ts`: artwork validation regression coverage.
- `electron/eon2/media-player-smoke.cjs`: isolated Electron UI validation with synthetic artwork and intercepted commands.
- `mobil/app/src/eon2/kotlin/com/kapanis/mobil/eon2/ui/EonMediaPlayer.kt`: background image decoding, cover-derived ambience and 48dp secondary/52dp primary touch targets.
- Android `LandscapeDeck.kt`, `ControlDeckOverview.kt`: player integration.

## Verification

- `npm run build`: passed, including renderer and Electron TypeScript. Final CSS adjustment additionally verified with `npx --no-install vite build`. Vite reports the existing large-chunk warning.
- `npx --no-install tsx electron/eon2/agent/WindowsDeckTelemetry.test.ts`: 5/5 passed, including existing permission checks and bounded artwork rejection cases.
- Windows thumbnail conversion was exercised using a real WinRT file stream. A subsequent live Windows session read returned **Ah Bir Ataş Ver — Fatma Turgut**, paused, with an 11,371-character artwork data URL. This verifies metadata/artwork reading, not sending playback commands to that app.
- Electron smoke passed at actual widths **722, 900, 1440, 1920 and 3840**. All six buttons stayed inside the player horizontally; loaded artwork and ambilight were present; page and player had no horizontal overflow. It also verified command dispatch, paused state, missing cover, long metadata, keyboard focus and all controls disabled when unavailable. Screenshots in `qa-media-player` use a synthetic test cover. Windows uses 125% display scaling. The smallest requested 720px window became 722px. A first 4K attempt was clamped; the final run reached 3840px as recorded in `results.json`.
- Android `:app:compileDebugKotlin :app:lintDebug --offline --no-daemon --max-workers=1`: BUILD SUCCESSFUL; lint **0 errors, 50 warnings** across the app. Kotlin recovered from an incremental-cache error; lint emitted unrelated quick-fix reporting exceptions but produced its reports and exited 0.

Physical Android visual acceptance, TalkBack, 200% fonts and performance profiling are still open. No new APK was installed, no production release was published, and real playback/volume commands were not sent during these tests. Extremely short custom cards retain vertical scrolling so controls remain reachable.
