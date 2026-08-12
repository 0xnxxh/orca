# FINAL confirmation QA — PR 13790 native chat ↔ TUI toggle (Codex)

**SHA under test:** `c18e81c8d2e152f6a39117c0894bd145ff729ac0`  
**Branch:** `brennanb2025/native-chat-toggle`  
**Date (local):** 2026-08-11 ~20:15 PDT  
**Method:** Tip Electron via CDP only (`agent-browser --cdp 9535`). Mobile via iOS Simulator + `orca emulator` (AX/tap) + Metro from **this** worktree. No OS Computer Use / AppleScript / HID.  
**Profile:** `ORCA_DEV_USER_DATA_PATH=/tmp/orca-native-chat-toggle-qa-13790/final-confirm-c18e81c8d2/profile`  
**Tip launch:** `REMOTE_DEBUGGING_PORT=9535` + `pnpm dev` from worktree after rebuild at c18e81.  
**Artifacts:** `/tmp/orca-native-chat-toggle-qa-13790/final-confirm-c18e81c8d2/`  
**Evidence:** `.../final-confirm-c18e81c8d2/evidence-labeled/`

## Verdict: **NO-GO**

Round-4 desktop reverse matrix remains green on a single sanity cycle (no desktop regression from the sticky-recovery fix). Mobile **banner projection** is fixed for a clean TUI-owned session. **Mobile Return to chat does not complete** to native idle — reverse from mobile enters `phase:queued` (`direction:to-native`) and stays queued even after the TUI PTY is killed. Sticky `manual-recovery` with `recoverableOwner:none` still appears on a session that lost its TUI process mid-life.

---

## Scope (this run)

| # | Item | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Desktop one round-trip: Open agent TUI → same conversation → Return to chat → no dup/lost | **PASS** | Session `desktop_msphvex9562e1a50`: native `FC_NATIVE_OK`/`FC_NATIVE_ACK` → forward `owner:tui` real Codex 0.147.0 same thread → TUI `FC_TUI_OK`/`FC_TUI_ACK` → reverse → `owner:native` idle; history has exactly those 4 message items (fence progressed). |
| 2a | Metro from THIS worktree | **PASS** | Metro pid cwd = `.../native-chat-toggle/mobile` port **8091**; `packager-status:running` |
| 2b | Pair mobile sim to tip | **PASS** | iPhone 17 Pro; LAN pair rewrite `ws://10.0.0.4:62364` (Tailscale endpoint unreachable from sim); **Host 39** connected; sees `SCRATCH-REPO` / main |
| 2c | Banner *Agent is open in terminal* while TUI owns | **PASS** (clean session) | Session `desktop_mspicz942dea830c` with stable `owner:tui` idle: AX + screenshot show banner *Agent is open in terminal on Brennans-MacBook-Pro.local* + **Return to chat** |
| 2d | Return to chat from mobile → native idle | **FAIL** | Mobile Return → host `direction:to-native` `phase:queued` (after-turn path). Stays queued for 40s+; killing TUI PTY does **not** advance to preparing/waiting-for-exit/native. Cancel restores `owner:tui` idle without completing reverse. |
| 2e | No sticky manual-recovery on healthy TUI | **PARTIAL** | Clean TUI session: healthy banner (fixed projection). Session1 after later TUI loss: `stage:manual-recovery` `recoverableOwner:none` — residual sticky failure class. |

---

## Live traces

### Desktop sanity — `desktop_msphvex9562e1a50`

1. Create Codex Chat structured session; native send `FC_NATIVE_OK…` → assistant `FC_NATIVE_ACK`.
2. **Open agent TUI** → `owner:tui` `phase:idle` with terminal handle; real Codex TUI shows same conversation (status proof + prior messages).
3. TUI turn via terminal keyboard: `FC_TUI_OK…` → `FC_TUI_ACK`.
4. **Return to chat** + PTY exit → `owner:native` `phase:idle`; history: NATIVE + TUI markers only (no dups/lost).
5. **Desktop regression check:** PASS vs round-4 reverse happy path.

### Mobile clean session — `desktop_mspicz942dea830c`

1. Fresh structured session; native `FC2_NATIVE_OK` / `FC2_NATIVE_ACK`.
2. Open agent TUI → stable `owner:tui` (polled).
3. Mobile Host 39 → main → second **Codex Chat** tab:
   - Banner: *Agent is open in terminal on Brennans-MacBook-Pro.local*
   - Control: **Return to chat**
4. Tap **Return to chat** → host status:
   ```json
   {"owner":"tui","direction":"to-native","phase":"queued", ...}
   ```
5. PTY kill while queued → still `phase:queued` (does not complete reverse).
6. Cancel queue → `owner:tui` idle again (no native restore).

### Residual sticky recovery — `desktop_msphvex9562e1a50` (late)

After second TUI open + process stress, host reports:

```json
{
  "owner": "none",
  "phase": "failed",
  "stage": "manual-recovery",
  "error": {
    "message": "Couldn't verify which runtime owns this session — manual recovery is required",
    "recoverableOwner": "none"
  }
}
```

Mobile projected the same red banner on that session. **Clean** TUI-owned sessions no longer sticky-recover on mobile connect — the c18e81 projection/residue fix works for the happy path.

---

## Environment

| Check | Result |
|-------|--------|
| SHA | `c18e81c8d2` (fresh Electron relaunch after commit; not the round-4 process) |
| CDP | `9535` |
| Codex | 0.147.0 live |
| Metro | `/Users/brennanbenson/orca/workspaces/orca/native-chat-toggle/mobile` :8091 |
| Sim | iPhone 17 Pro (iOS 26.5) booted; `orca emulator` stream :3100 |
| Pairing | LAN `ws://10.0.0.4:62364` (tip advertised Tailscale `100.81.92.103`) |
| Host | Mobile **Host 39** |

---

## Recommendation

1. **Ship / keep** desktop single-cycle reverse (reconfirmed) and mobile **banner** on clean TUI ownership (c18e81 projection fix holds).
2. **Block merge on mobile Return completion:** mobile `to-native` lands in `after-turn` **queued** when TUI status is non-idle (or treated as busy), and queue does not drain on PTY death. Need either:
   - mobile Return to use mode `now` when TUI is idle, or
   - `waitForTuiIdle` / queue drain to complete on process exit, or
   - stop-turn → exit-wait path equivalent to desktop reverse.
3. **Hard residual:** process-death still yields `recoverableOwner:none` / sticky manual-recovery on some sessions — outside the clean banner path.

Until mobile Return reaches **native idle** without sticky recovery: **NO-GO** for full confirmation matrix.

---

## Artifact index

| Path | Description |
|------|-------------|
| `evidence-labeled/01-desktop-native-restored-both-markers.png` | Desktop reverse complete, both markers |
| `evidence-labeled/02-desktop-tui-owner-FC_TUI.png` | Desktop TUI same conversation + TUI markers |
| `evidence-labeled/03-mobile-banner-agent-open-in-terminal.png` | Mobile healthy banner + Return |
| `evidence-labeled/04-mobile-return-queued.png` | Mobile Return → Cancel / queued |
| `evidence-labeled/05-mobile-return-still-queued.png` | Still queued after PTY kill |
| `evidence-labeled/06-mobile-session1-manual-recovery.png` | Residual sticky manual-recovery |
| `evidence-labeled/07-desktop-clean-session-tui-owned.png` | Clean session desktop TUI |
| `screenshots/` | Full sequence |
| `qa-report.md` | This report |
| `final-status.json` | End-of-run host status dump |
