# STA-4019 / PR 14085 Electron QA

**Verdict:** matching-host CTA holds. Fail-closed holds when the active workspace browser runtime is switched away from the import host. **Genuine two-host coverage was NOT achieved.**

## CDP owner (invalidates everything if wrong)

Launched isolated dev instance from this worktree only.

| Check | Result |
| --- | --- |
| Checkout | detached `6f4b62aa1d80f639a4b9ff45e6edcd22181ebc34` — `fix(browser): preserve local sign-in partition` |
| CDP port | `9335` (9333/9334 occupied; scanned 9333–9340) |
| Renderer | `127.0.0.1:5175` (5173 occupied) |
| User data | `/tmp/orca-qa-14085-sta4019/orca-user-data` |
| `window.api.app.getIdentity()` | `name: "Orca: 6f4b62aa1d"`, `devLabel: "qa-14085-sta4019 @ 6f4b62aa1d"`, `devBranch: "6f4b62aa1d"`, `devWorktreeName: "qa-14085-sta4019"`, `devRepoRoot: "/Users/brennanbenson/orca/workspaces/orca/qa-14085-sta4019"` |
| Live user app | not attached (adhoc `1.4.181` left running) |

## What was proven (rendered)

Import host A = **Local Mac**. Profile = **STA-4019 QA Profile** (`650dd8cf-fb7c-487d-8e3d-6b41c48eb2a7`, partition `persist:orca-browser-session-650dd8cf-fb7c-487d-8e3d-6b41c48eb2a7`). Chrome `stably.ai` import: 869 cookies imported, **72 Google cookies skipped**.

### 1. Import completed on host A, CTA presented

`04-import-complete-cta.png`

- Profile row shows `STA-4019 QA Profile` / `Google Chrome (stably.ai)`.
- Success toast: imported 869 cookies into that profile.
- Warning toast: “Google cookies were not imported. Open a browser in Orca **on Local Mac** with this profile…”
- Action **Sign in to Google** is present because the active workspace browser runtime was also local.

### 2. CTA authenticates against host A + exact imported profile

`06-google-signin-tab-profile.png` (backing store also recorded)

Clicking **Sign in to Google**:
- Closed Settings.
- Opened an Orca browser tab at `https://accounts.google.com/...` (rendered Google Sign in).
- Tab `sessionProfileId` = `650dd8cf-fb7c-487d-8e3d-6b41c48eb2a7` (not `default`).
- Tab `sessionPartition` = `persist:orca-browser-session-650dd8cf-fb7c-487d-8e3d-6b41c48eb2a7` (exact imported partition; no default-partition fallback).

### 3. Mismatch fail-closed (simulated runtime switch — not two-host)

`07-mismatch-toast-no-cta.png`

The isolated QA instance had **no second Orca runtime environment** (pairing code required; user’s “Windows low spec” env lives on the live app and was not reused). Docker was unavailable, so the throwaway Linux SSH-container path could not be used.

Mismatch was exercised by switching the **active workspace browser runtime** to `runtime:qa-mismatch-host` (store `setActiveWorktree`, not a real second machine), then repeating the same Chrome import:

- Same host-aware warning: “Open a browser in Orca **on Local Mac**…”
- **No Sign in to Google button.**
- `openBrowserProfileTabInActiveWorkspace(..., profileId, 'local')` returned `false`.
- Opening against the mismatch host also returned `false` and created **no** extra local tab.

This is **simulated** coverage of the fail-closed path. It is **not** two-host.

## Two-host: attempted, not achieved

| Attempt | Result |
| --- | --- |
| User live “Windows low spec” runtime (`ws://127.0.0.1:16768`) | Present on the **live** app only. Isolated QA instance `runtimeEnvironments.list()` = `[]`. Adding it needs a pairing code. Not copied from the live profile. |
| `brennan-test-ssh` Docker Linux box | Docker unavailable. |
| Real SSH host `openclaw` (`brennan@openclaw.orca-procyon.ts.net`, Linux `neil-ubuntu`) | Connected in the QA instance (`08-ssh-openclaw-connected.png`). Relay deployed `linux-x64` and reported connected. |

SSH is **not** a second browser-profile host. `getBrowserRuntimeHostIdForWorktree` stays `local` for an SSH worktree unless a runtime environment is attached. So `openclaw` proves a second *SSH* machine was reachable; it does **not** prove import-on-A / workspace-browser-runtime-on-B.

### What remains unproven

1. Cookie import executed on a **real** second browser-profile host (Windows runtime or remote Orca server).
2. CTA opening a sign-in tab on that remote host’s exact imported profile.
3. Fail-closed when the active workspace is a **real** remote browser runtime (not a store-injected `runtime:qa-mismatch-host`).
4. Paired SSH workspace whose browser runtime is a remote HUB (the unit-tested `ssh:` + `runtimeOwnerEnvironmentId` case).

Do not describe this run as two-host.

## Safety

- Did not kill, quit, or restart the user’s live Orca / Electron.
- Did not push to the PR branch.
- Did not modify product code.

## Screenshots

| File | What it proves |
| --- | --- |
| `01-settings-browser-profiles.png` | Isolated Settings → Browser before import |
| `02-import-cookies-menu.png` | Import menu on STA-4019 QA Profile |
| `03-chrome-profile-submenu.png` | Chrome `stably.ai` / `Brennan` sources |
| `04-import-complete-cta.png` | Import on Local Mac + **Sign in to Google** CTA |
| `05-cta-opened-google-signin.png` | CTA click landed on Google sign-in (brief overlay) |
| `06-google-signin-tab-profile.png` | Rendered Google Sign in in the imported-profile tab |
| `07-mismatch-toast-no-cta.png` | Simulated mismatch: warning, **no** CTA |
| `08-ssh-openclaw-connected.png` | Real Linux SSH connected; not a browser-runtime host |
