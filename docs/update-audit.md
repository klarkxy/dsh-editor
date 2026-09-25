# Desktop update audit and recovery

## Scope

The desktop release-update chain: stable release lookup, platform/package selection,
checksum acquisition, mirror fallback, cancellation, cached downloads, IPC authority,
Windows installed/portable handoff, macOS manual installation, About-page recovery,
and release publishing. This does not change DSH's plugin manager, author files,
profile migration, runtime pinning, or the editor's normal save/quit lifecycle.

## Findings and changes

- A child-process `spawn` event was treated as permission to quit. A spawned shell
  can fail before running its actual update command. The app now waits for a
  transaction-specific `ready` status, commits it, and only then requests normal
  application shutdown. Startup failures leave the editor open with diagnostics.
- The old cmd/batch replacement embedded paths in shell source and recursively
  removed a fixed `.new` path. It is replaced by an independent Windows PowerShell
  helper with base64-encoded UTF-8 JSON input, literal path handling, exclusive
  staging, unique backups, and no recursive cleanup of destination paths.
- Portable staging and hashing happen before quit. Replacement waits for the
  actual parent process handle to exit. A vetoed/delayed quit times out without
  replacing the live app. A failed swap/start attempts rollback and retains the
  downloaded package and diagnostics; an unrecoverable rollback names its backup.
- Installed Windows updates start the installer after the editor exits. NSIS's
  final `/D=` argument remains unquoted, including directories containing spaces.
  Installer errors/cancellation are reported by the helper, with manual recovery.
- Both version comparison and package selection are stricter. The renderer cannot
  supply URLs, hashes, filenames or destinations. Official URL/tag/basename,
  product, version, architecture, positive size and SHA-256 must agree.
- Missing official digests can be recovered only from the official checksum file,
  with a timeout. Conflicting checksum lines are rejected. Mirrors deliver bytes,
  not trust. Oversized bodies stop at the authenticated size. Incomplete transfers
  use `.part`; verified files become installable only after hashing and rename.
- A fresh check is serialized against download/install. Transient check errors no
  longer erase verified downloads. Same-tag/name asset replacement invalidates
  stale receipts. Installation rehashes against the current trusted offer.
- About exposes the actual package path and recovery-folder action. Closing and
  reopening settings, or restarting the app, can recover a matching cached package
  only after a fresh official offer and re-verification. macOS remains manual.
- Publishing refuses to overwrite an already public release. Uploads and checksum
  replacement must happen in a draft so clients cannot observe a half-replaced
  asset set. This audit does not publish any release.

## Files and diagnostics

On Windows, open `%TEMP%\dsh-editor-update`. Each completed download has a unique
`download-*` directory. Failed transfers may leave `.part` files if Windows locks
cleanup; they are never offered for installation.

Each Windows install attempt keeps `install-*` under its download directory:
`helper-startup.log` captures bootstrap errors, `helper-worker.log` and its `.err`
companion capture worker output, `install.log` records the transaction, and `status.json` contains the final phase and backup path. The old
single `%TEMP%\dsh-editor-portable-update.log` belongs to the retired batch updater.

Portable backups are adjacent to the original executable, named `.bak-<nonce>`.
They are not deleted automatically. Keep a backup until the new application and
its documents are confirmed healthy. An operating-system temp cleanup may remove
cached downloads; the updater then requires a fresh download.

## Regression gates

`Update regression` runs the desktop suite on Windows, including actual
PowerShell/process/file operations. Fixtures verify Unicode and shell metacharacter
paths, parent-exit ordering, backup preservation, staged-file tampering, missing
files/directories, failed-launch rollback, inherited launcher environment, and
real final `/D=` command-line handling. They use disposable unsigned fixture EXEs,
not the user's installed application and not an actual NSIS product installation.

The regular PR build/typecheck/full Vitest suite and desktop runtime packaging
workflow remain in place. UI tests check that the completed-download path and
recovery actions remain available. Existing UI design/drift gates still apply.

## Manual release acceptance

Automated fixture success is not proof of a full installed-app upgrade. Before
publishing binaries, exercise an actual old installed build and portable build
on Windows, including accepting/cancelling UAC, antivirus/enterprise policy,
locked files, insufficient disk space, graceful shutdown with unsaved work, and
reopening the user's workspace. Confirm light/dark About layout, keyboard access
and long paths. On macOS, confirm Finder reveal and manual DMG installation.

The helper's `launched` phase confirms process launch, not long-term application
health. The NSIS `completed` phase reflects its exit status. No tag, package or
public release is created merely by merging this code change.
