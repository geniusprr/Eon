# Eon Notes: desktop and Android UX

The active Eon 2 notes feature uses the shared immutable revision protocol in
`packages/notes-sync`. Desktop owns an SQLite `NotesRepository`; Android
owns a separate SQLite `EonNotesRepository`. USB/Tailscale transport exchanges
operation deltas. The legacy filesystem `vaultStore` is a separate data
source and is not mounted into this Eon 2 workspace.

## Desktop

- `src/eon2/EonNotesWorkspace.tsx` is loaded on first opening Notes; the
  component remains mounted when moving between product sections so open tabs
  and unsaved drafts survive navigation.
- `MarkdownEditor.tsx` uses the installed MIT-licensed CodeMirror 6 engine.
  The separate GFM preview is loaded only when entering reading or split mode.
- The folder tree uses synced `metadata.path` values. New notes and imported
  Markdown files use safe relative `.md` paths. Existing notes without paths
  fall back to `Notes/<noteId>.md`; they are not filesystem files.
- Saving sends `expectedRevisionId` to the SQLite CAS transaction.
  Changes received while editing never overwrite a dirty local tab; copy or
  manual conflict resolution remains available.
- One-second idle saves and the close-tab safeguard reduce lost typing.
  A window-close warning is shown for drafts awaiting acknowledgement.
  Search covers title, path and text; `[[wiki links]]` use the title lookup,
  and tags/outline/backlinks are built from Markdown text.
- File import/export is explicit. Export writes Markdown via a browser download.
  Import writes one canonical revision per file. A real filesystem vault
  mirroring/export of all files and migration from legacy vaults require a
  separate migrator with collision and recovery checks.

## Android

- `NotesScreens.kt` contains an adaptive file tree, search, sort, source
  editor, reading preview, formatting toolbar and local AtomicFile drafts.
- Local drafts are kept separately from authoritative synced revisions.
  Save/delete and conflict resolution continue to use revision guards.
- The note screen is reachable in both portrait and landscape.
- Size limits are calculated from UTF-8 bytes to match desktop (5 MiB).

## Validation

Desktop TypeScript compilation, Electron TypeScript compilation, and Vite
bundling were verified in a separate output directory. Note journal, protocol,
path collision and Markdown preview tests passed. Android debug Kotlin
compilation and APK assembly passed. The shared Android unit-test suite still
contains a legacy `RemoteCoordinateMapperTest` source-set compilation error,
so its new size-limit tests require a separate run once that unrelated test
source is updated. Actual physical device sync and screenshot comparison
remain additional release checks.
