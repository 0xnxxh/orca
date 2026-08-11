# Restored-shell Codex hook-trust validation

## Root cause

Restored daemon shells became interactive after the daemon and hook server started, while managed Codex hook reconciliation remained an unawaited background task. A retained shell could therefore launch manually typed `codex` against its launch-time managed home before Orca refreshed that home's hook definitions and trusted hashes. The background repair then made persisted state and later `hooks/list` checks look healthy.

The retained shell's launch-time home is independent of the currently selected Codex routing lane. Startup now inventories authoritative live daemon PTYs on every retained-shell startup, resolves only registered Orca-managed host homes, and reconciles those homes before the startup gate completes.

## Security boundary

- Shared and legacy managed homes resolve only to Orca's private runtime home.
- Per-account homes pass existing Orca ownership validation.
- Real-home, WSL, SSH/non-host, unknown, missing-account, and unowned paths are skipped.
- Enabled settings reinstall/repair only Orca-managed hooks.
- Disabled settings remove only Orca-managed entries while preserving user hooks.

## Electron/CDP reproduction

Build:

```bash
pnpm run build:electron-vite
```

Isolated launch (the shortened profile path avoids the Unix-socket path limit):

```bash
/usr/bin/env -u ELECTRON_RUN_AS_NODE -u CODEX_HOME -u ORCA_CODEX_HOME \
  PATH='/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  HOME='/tmp/orca-rce-060679/home' \
  USERPROFILE='/tmp/orca-rce-060679/home' \
  ORCA_E2E_USER_DATA_DIR='/tmp/orca-rce-060679' \
  ORCA_E2E_HOME_DIR='/tmp/orca-rce-060679/home' \
  ORCA_E2E_HEADFUL=1 NODE_ENV=development \
  '<worktree>/node_modules/.pnpm/electron@43.1.0/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' \
  out/main/index.js --remote-debugging-port=9460
```

Validation used `agent-browser --cdp 9460` only. A real floating-shell PTY was created, the Electron main process was terminated without stopping the daemon, its pane registry retained the managed shared-home route, and an Orca lifecycle-hook `trusted_hash` was made stale. A deterministic Codex fixture was added only after startup so it reported the same review/ready state from the managed config without allowing generic startup CLI detection to hide the race.

Local capture filenames (uploaded to the PR as GitHub attachments; intentionally not committed):

- Before: `restored-codex-hook-review-before.png`
- After: `restored-codex-hook-trusted-after.png`
- Fresh pane: `fresh-codex-hook-trusted.png`
- Disabled hooks after retained restart: `restored-codex-hooks-disabled.png`

The pre-fix restart retained the stale hash and showed `Hooks need review`. The fixed restart repaired it before `awaitFirstWindowStartupServices()` resolved and the same retained PTY showed trusted/ready. A fresh pane reached normal Codex onboarding without a hook-review prompt. With `agentStatusHooksEnabled: false`, a retained restart left `hooks.json` as `{ "hooks": {} }` and `config.toml` with an empty `[hooks.state]`.

## Automated validation

```bash
pnpm exec vitest run \
  src/main/codex/retained-codex-hook-state.test.ts \
  src/main/startup/desktop-startup-ordering.test.ts \
  src/main/codex-accounts/runtime-home-service.test.ts

pnpm run typecheck:node

pnpm exec oxfmt --check \
  src/main/index.ts \
  src/main/codex-accounts/runtime-home-service.ts \
  src/main/codex-accounts/runtime-home-service.test.ts \
  src/main/codex/retained-codex-hook-state.ts \
  src/main/codex/retained-codex-hook-state.test.ts \
  src/main/startup/desktop-startup-ordering.test.ts

pnpm exec oxlint \
  src/main/index.ts \
  src/main/codex-accounts/runtime-home-service.ts \
  src/main/codex-accounts/runtime-home-service.test.ts \
  src/main/codex/retained-codex-hook-state.ts \
  src/main/codex/retained-codex-hook-state.test.ts \
  src/main/startup/desktop-startup-ordering.test.ts

git diff --check
```

Results: 113 focused tests passed; node typecheck, formatting, direct oxlint, diff check, and Electron build passed. The aggregate changed-code script was not used because Node 26's unsupported-engine warning breaks its JSON parser; direct oxlint covered all changed source files.

## Remaining risk

The repair deliberately covers only host-side Orca-managed runtime homes recorded for live PTYs. Folder workspaces use the same verified host-home path; real-home, WSL, SSH, and arbitrary user or repository hook paths are not auto-trusted, and their existing launch-specific flows remain unchanged.
