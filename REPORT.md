# Electron A/B QA2 — PR #13014 (daemon path fix @ 16158809ed)

**Date:** 2026-08-07  
**Branch head:** `16158809ed` — `fix(terminal): drop a too-wide daemon alt frame on reattach`  
**Main A/B:** detached `origin/main` @ `8c3e9535c7`  
**Artifacts:** `/Users/brennanbenson/orca-qa/pr-13014-qa2/`  
**Harness:** `tui_static_frame.py` (paints once, ignores SIGWINCH)

## Method

Isolated `pnpm dev` Electron instances with short `ORCA_DEV_USER_DATA_PATH` (`/tmp/oqa2m`, `/tmp/oqa2b`) so the daemon Unix socket path stays under the macOS limit. Long temp templates (`…qa2-branch.XXXXXX…`) caused `listen EINVAL` and silent LocalPty fail-open — those runs are archived under `invalid-no-daemon/` and **do not count**.

- CDP ports free before launch; identity via `window.api.app.getIdentity()` + process command line (`user-data-dir=/tmp/oqa2*`, `remote-debugging-port=936x`).
- E2E parking: `VITE_EXPOSE_STORE=true`, `ORCA_E2E_TERMINAL_PARKING_DELAY_MS=2000`, `ORCA_E2E_TERMINAL_RETENTION_LIMIT=1`.
- Remount verified: `parkedTabIds` includes the TUI tab, `xtermCount` drops while parked, daemon session ids use `worktreeId@@…` form.
- Scenario: maximize → static alt frame + scrollback → park w0 (switch w1→w2) → wait cold park → resize → reveal → screenshots at 0, 0.25, 0.5, 1, 2, 5, 10s.

Brennan’s Orca `/Applications/Orca.app` **PID 86619** never killed.

## Results

| Scenario | Result | Evidence | Notes |
|---|---|---|---|
| **A/B main: static narrower park-reveal** | **GARBLED (control)** | **PIXELS** | `main-narrow-wide.png` clean cols=135; `main-narrow-reveal-t*.png` split-row reflow (`R07-GARB…`). Remount: parkedTabIds + xtermCount 3→2. |
| **A/B branch: static narrower park-reveal** | **STILL GARBLED** | **PIXELS** | Same reflow debris class as main at t=0…5s. **Not** a clean blank/skip outcome. Daemon remount confirmed. |
| Branch same-width park-reveal | **PASS frame paints** | **PIXELS** | t0 blank (remount settle); t1+ full `STATIC-ALT-FRAME` intact. |
| Branch wider park-reveal | **PASS frame paints** | **PIXELS** | Full frame after max reveal. |
| Scrollback present (branch cases) | **PASS (store)** | **STORE** | `getMainBufferSnapshot.scrollbackAnsi` contains `SCROLLBACK-LINE` markers after reveal. Pixel scrollback not shown under alt screen. |
| Cold restore (owner gone) | **NOT TESTED** | — | Would require killing the daemon session owner separately; not completed in this run. |

## Deciding experiment conclusion

With a **static** alt frame and a **real daemon remount** (not hot-retain fit-only):

- **main:** garbled (expected control) — PIXELS  
- **branch @ 16158809ed:** **still garbled** — PIXELS  

The daemon-path fix does **not** eliminate the reflow garble in this Electron A/B. A blank alt screen was **not** observed on the branch for the narrower remount.

### Notes for authors

1. Remount path was exercised (`ordinaryParkingCovers: true`, parked tab id present, xterm unmounted while parked, daemon `@@` session ids).
2. No `[altskip-diag]` instrumentation on this clean head — cannot name the paint branch from console. Pixel outcome alone is decisive for “still garbles”.
3. Likely remaining gaps (hypothesis only): `readProposedTerminalCols` undefined at daemon snapshot paint time → skip false; or skip runs but a later path re-paints the full frame before fit.
4. Invalid first pass (LocalPty fail-open because user-data socket path too long) is archived and must not be used for conclusions.

## Safety

- QA instances shut down after report (see cleanup).
- PID 86619 untouched.
- PR worktree git status clean (no source edits).
