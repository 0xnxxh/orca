# Phase 1 SFTP upload lazy boundary — 2026-07-29

## Result

Retained. Authoritative orchestration task `task_703fd93c9edd` reports that the
production Electron main entry decreased by 4,984 raw bytes and 959 gzip bytes,
the two task-scoped static-plus-dynamic false-boundary warnings disappeared, and
the implementation emitted as a separate packaged-relative chunk.

## Importer audit and retained boundary

Before the split, eager imports in the filesystem provider, file-upload session,
relay deploy helpers, and relay install transfers kept `sftp-upload.ts` in the
main entry despite dynamic imports from `ssh-connection.ts`.

The retained boundary is the typed `loadSftpUploadCapability()` in
`src/main/ssh/sftp-upload-capability.ts`. Current production importers preserve
their prior owners and load the exact module only at an upload boundary:

- `ssh-filesystem-file-upload.ts` loads `uploadFile` when an SFTP upload session
  opens, after confirming that an SFTP factory exists.
- `ssh-filesystem-provider.ts` loads `uploadBuffer` only for binary SFTP writes;
  raw runtime transfers stay outside the capability.
- `ssh-relay-deploy-helpers.ts` keeps its public upload and directory-creation
  wrappers while loading the exact implementation on first use.
- `ssh-relay-install-transfers.ts` keeps system SSH transfers eager and loads
  the SFTP implementation only for fallback transfers after namespace mapping.
- `ssh-connection.ts` loads the capability in its non-system-SSH directory,
  upload-session, string-write, and buffer-write paths.

The capability exposes the original `mkdirSftp`, `uploadBuffer`,
`uploadDirectory`, `uploadFile`, and `writeStringViaSftp` identities. It does not
move relay lifecycle, connection-manager, namespace, abort, or session
ownership.

## Behavior preserved

Focused boundary and transfer coverage establishes:

- append and exclusive write flags reach `uploadBuffer` and `uploadFile`
  unchanged;
- one opened SFTP session still covers a file-import session and closes through
  its prior owner;
- system SSH directory and file transfers do not load the SFTP upload module;
- fallback relay transfers resolve the SFTP namespace before upload;
- aborting an in-flight fallback upload closes the SFTP session and preserves
  the prior abort error;
- local, WSL, SSH, relay, runtime, and folder-workspace routing remain at their
  existing owners.

The implementation functions retain their existing stream cleanup, recursive
directory upload and cleanup, string write, and directory creation semantics.

## Production A/B

| Surface       |     A raw |     B raw | Raw change |    A gzip |    B gzip | Gzip change |
| ------------- | --------: | --------: | ---------: | --------: | --------: | ----------: |
| Electron main | 8,144,565 | 8,139,581 |     -4,984 | 1,701,684 | 1,700,725 |        -959 |

The B build emitted
`out/main/chunks/sftp-upload-CWnSPG0Z.js`. The A graph mixed static and dynamic
edges to `sftp-upload.ts` and `ssh-relay-deploy-helpers.ts`; neither
false-boundary warning remained in B.

The historical Electron-main raw budget moved from 8,195,000 to 8,190,016,
exactly matching the 4,984-byte reduction and leaving 50,435 bytes of headroom
over B.

Later retained tranches changed content hashes without collapsing the boundary.
The current production output contains
`out/main/chunks/sftp-upload-Pl2pg0V1.js`, and its sibling importer
`out/main/chunks/ssh-BJXSynrt.js` contains the literal relative edge
`require("./sftp-upload-Pl2pg0V1.js")`. The current chunk is 6,562 raw bytes
with SHA-256
`534f71c3676fd3cbbb6de33e9acb752fec6f6e67a648cd36ebbccdf532819667`.

## Validation

The authoritative task records these passing gates:

- focused filesystem-provider upload-boundary and relay-transfer tests;
- fresh A and B `pnpm run build:electron-vite`;
- `pnpm run check:electron-bundle-budgets`;
- `pnpm run typecheck:node`;
- targeted `pnpm exec oxlint --deny-warnings`;
- targeted `pnpm exec oxfmt --check`;
- `pnpm run check:max-lines-ratchet`;
- `git diff --check`.

## Limitations

The production build and emitted relative edge establish the packaged path
shape, but no live packaged SFTP upload smoke ran on macOS, Linux, or Windows.
Cross-platform packaged upload, abort, permission, and remote-filesystem
behavior therefore remain unresolved.
