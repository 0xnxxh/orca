# Phase 1 account-runtime coordination startup boundary — 2026-07-29

**Scope:** Move the remaining direct account-target, MiniMax-cookie, Claude
runtime-selection, and live-PTY coordination values behind one exact-identity
app-ready capability without moving account policy or cross-domain path/runtime leaves.

## Result

`src/main/index.ts` now dynamically imports
`./startup/account-runtime-coordination-startup-capability` immediately after installing
the retained crash/hang capability. It installs the exact returned object in a typed,
fail-closed owner before crash-store setup, Store construction, live-PTY hydration, or
any account/rate-limit consumer.

| Surface       | Before raw | After raw | Raw change | Before gzip | After gzip | Gzip change |
| ------------- | ---------: | --------: | ---------: | ----------: | ---------: | ----------: |
| Electron main |  3,557,573 | 3,544,763 |    -12,810 |     750,742 |    748,197 |      -2,545 |

The preload and renderer outputs remained byte-identical:

| Surface          | Raw bytes | Gzip bytes | JavaScript | CSS |
| ---------------- | --------: | ---------: | ---------: | --: |
| Electron preload |   130,798 |     20,642 |          1 |   0 |
| Main renderer    | 9,815,193 |  2,190,210 |        294 |   3 |
| Dashboard popout | 5,894,305 |  1,297,290 |         83 |   3 |
| Web renderer     | 4,360,776 |    928,388 |         33 |   1 |

## Production importer audit

Before this tranche, `index.ts` eagerly value-imported:

- `readMiniMaxSessionCookie`;
- `getInitialClaudeRateLimitTarget`;
- `getInitialCodexRateLimitTarget`;
- `createAccountRuntimeTargetSettingsSync`;
- `normalizeClaudeRuntimeSelection`;
- `attachClaudeLivePtyPersistence`;
- `onLiveClaudePtysDrained`; and
- `seedLiveClaudePtysFromPersistence`.

The complete production audit found:

- `minimax-cookie-store` is also imported by rate-limit service status checks and
  MiniMax credential IPC. The capability returns the same module function, preserving
  the one cached cookie, safeStorage behavior, legacy-envelope migration, file
  hardening, and error behavior.
- `claude-rate-limit-target` and `codex-rate-limit-target` are also composed by
  `account-runtime-target-sync`; there are no other direct startup importers.
- `account-runtime-target-sync` otherwise had only the direct `index.ts` importer.
- `claude-accounts/runtime-selection` is also used by the Claude account/auth services
  and Claude rate-limit targeting; window, PTY, and account IPC consumers are
  type-only where applicable.
- `live-pty-gate` is also used by Claude account/auth services, PTY handling, and daemon
  initialization. ES module caching preserves the one live/seeded PTY sets, persistence
  target, drain-listener set, and auth-switch state across all retained dynamic graphs.

No candidate has a pre-`app.whenReady()` call. Cross-platform path comparison, default
WSL distro selection, account/auth restart preservation, WSL/SSH providers, and
unrelated leaves remain eager and unchanged.

## Lifecycle and identity reasoning

The capability is installed after crash/hang capability installation and before its
first consumer. Startup order remains:

1. create Store and register the existing settings listener;
2. attach Store as live-Claude-PTY persistence;
3. register the drain listener that refreshes rate limits;
4. read persisted Claude PTY IDs and seed the shared gate;
5. construct account services, including Claude auth;
6. set Codex then Claude initial rate-limit targets;
7. create the settings-derived target synchronizer and register its Store listener;
8. install the unchanged status-line, MiniMax, inactive-account, proxy, and other
   rate-limit resolvers.

This keeps seeding before the Claude auth constructor can refresh a surviving daemon
session's single-use token. The drain callback still observes the live `rateLimits`
singleton and uses optional access until account services exist. Initial target
resolution and settings synchronization still receive the exact same settings objects
and default `process.platform` input.

The MiniMax and inactive-Claude resolvers are live deferred callbacks, so they read the
required owner and fail closed if invoked before installation. The owner returns the
exact installed capability; it does not wrap or duplicate any function. The inactive
Claude resolver retains the original two normalization calls and resulting host/WSL
selection order.

No rate-limit polling policy, account selection, authentication, credential file,
runtime construction, PTY provider, shutdown behavior, or settings schema moved into
the capability. Local, WSL, SSH/remote, and folder-workspace behavior remains behind
the existing runtime/provider boundaries. No Git command or provider behavior changed.

## A/B evidence and hashes

Fresh production evidence:

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A: `/tmp/orca-account-runtime-coordination-a.ZJQkAo`
- B: `/tmp/orca-account-runtime-coordination-final-b.x6f9Aj`
- A transformed 1,997 main, 17 preload, and 9,181 renderer modules.
- B transformed 1,999 main, 17 preload, and 9,181 renderer modules.
- Both builds emitted only the two existing CSS `::highlight(...)` parser warnings.

Entry hashes:

- A `out/main/index.js` SHA-256:
  `ee3964bc76235c05c55ea67e53408dddabfa88ffec6e958de33323420c9b2fe6`
- B `out/main/index.js` SHA-256:
  `19b988fd4522bc961d6e36dc5e2a807b8a6c086b8c9aae5ced4a5d722c13c018`

The sorted A and B non-main manifests each contain exactly 786 rows and are
byte-identical. Their SHA-256 is
`e7fed74bb51c30b41084a2a5d052f5dc0773a696552f1a8e051d363ed4be762a`;
`diff -u` produced no output.

The A main manifest contains 135 rows with SHA-256
`4bc1da573d6dd46d3167ce729de32f55d91f9339ce2fb974776992255d1daf13`.
The B main manifest contains 137 rows with SHA-256
`a16db28743b70c72bfba3335c2e7c48e3dbd78899c86d5354bd45d695d1fa467`.

## Emitted chunk and closure

The retained build emits
`out/main/chunks/account-runtime-coordination-startup-capability-BWSWJ-5l.js` at
10,597 raw bytes with SHA-256
`ecae1f70ea42ac1fc0c18b07b8c4ede109aebb3435e1635eb70ddda2baa8d3c9`.
Its two direct literal relative edges are:

- `../index.js`
- `./minimax-cookie-store-nsVHFZ_v.js`

The `../index.js` edge is the bundler's shared-entry cycle and preserves existing
account/runtime singleton state rather than duplicating it.

An inclusive Acorn AST walk followed literal relative import, export,
dynamic-import, and `require` edges. The capability closure visited 127 JavaScript
files and validated 681 edges. A separate scan of all 137 emitted-main JavaScript
files validated 729 edges. Every target exists and remains beneath `out/main`; no edge
escapes the emitted directory.

## Budget arithmetic

The previous Electron-main raw budget was 3,605,809 bytes. Lowering only that value by
the exact 12,810-byte reduction produces 3,592,999 bytes:

`3,592,999 - 3,544,763 = 48,236`

Preload and renderer budgets are unchanged.

## Validation

- Fresh A and final B `pnpm run build:electron-vite`: passed.
- Focused capability/owner/source-boundary plus account services, Claude
  account/auth/runtime selection/live-PTY, Codex runtime selection, MiniMax
  credential/cookie, rate-limit target/synchronization/fetcher/service, terminal
  runtime, runtime-service, desktop startup ordering, daemon startup/WSL, PTY startup
  barrier, SSH rearm, remote runtime, folder-workspace path, renderer shutdown, and
  relaunch coverage: 56 files / 644 tests passed.
- `pnpm run typecheck:node`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with no new bypasses.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

## Platform limitation

The source, unit/integration tests, and generated-closure validation retain the existing
Windows path/safeStorage behavior, macOS lifecycle, Linux headless behavior, WSL,
SSH/remote, and folder-workspace gates. Packaged-ASAR launch verification was not run
on macOS, Linux, and Windows and remains explicitly unresolved.
