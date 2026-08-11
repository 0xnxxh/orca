# FINAL QA MATRIX RERUN — PR 13790 native chat ↔ TUI toggle (Codex)

**SHA under test:** `34635aed0f` (`34635aed0f7a16b5e5a10ecbc5c5e57b835b5366`)  
**Branch:** `brennanb2025/native-chat-toggle`  
**Date (local):** 2026-08-11 13:12 PDT  
**Method:** Tip Electron via CDP only (`agent-browser --cdp 9520`), DOM clicks + screenshots. No OS Computer Use / AppleScript / HID.  
**Profile:** `ORCA_DEV_USER_DATA_PATH=/tmp/orca-native-chat-toggle-qa-13790/profile-final-matrix-34635aed0f`  
**Tip launch:** `REMOTE_DEBUGGING_PORT=9520` + `run-electron-vite-dev.mjs` from worktree; renderer `127.0.0.1:5183`.  
**Artifacts:** `/tmp/orca-native-chat-toggle-qa-13790/final-matrix-34635aed0f/`  
**Evidence:** `/tmp/orca-native-chat-toggle-qa-13790/final-matrix-34635aed0f/evidence-labeled/`

## Verdict: **NO-GO**

Forward handoff remains live-green. Reverse completion is **not** multi-cycle green at this SHA:

1. **Session A** `desktop_msoxgqy46d41cefa`: full native→TUI with markers; reverse from idle entered `waiting-for-exit` then failed with **single recoverable owner `tui`** + **Retry** (`terminal_handle_stale`). Retry re-entered waiting-for-exit and did **not** restore native.
2. **Session B** `desktop_msoy0aq716e4ee65`: forward OK; busy after-turn reverse correctly **queued**, then **auto-fired** to `waiting-for-exit`, then failed hard with **`recoverableOwner: none`** / `stage: manual-recovery` / "Could not verify its Codex session" — **violates** the single-recoverable-owner failure contract.
3. Zero complete native→TUI→native cycles with TUI turns restored into the chat timeline. Mobile cross-client not exercised against this tip host.

Prior round-2 claim of reverse GO at this SHA is **not reproduced** in this full-matrix live rerun.

---

## Per-item table

| # | Item | Result | Evidence / notes |
|---|------|--------|------------------|
| 1a | Create structured Codex chat session | **PASS** | New Tab → Chat session → Codex Chat + Open agent TUI. Sessions A/B |
| 1b | Converse in native chat | **PASS** | `CYCLE1_NATIVE_OK`, `CYCLE2_NATIVE_OK` in chat timeline. `01-…`, `05-…` |
| 1c | Open agent TUI → real Codex TUI, same conversation | **PASS** | Both sessions: `owner:tui`, `phase:idle`, terminal handle+tab bound. TUI shows prior native turn. `02-…`, `05b-…` |
| 1d | Type a turn in TUI | **PASS (A)** | Session A: `CYCLE1_TUI_OK` visible in Codex TUI buffer. `02-cycle1-tui-owner-CYCLE1_TUI_OK.png` |
| 1e | Composer under TUI ownership via bridge | **PASS (via TUI)** | Native composer hidden while TUI owns; turns via real TUI PTY. Chat banner *Agent is open in terminal on Mac.hsd1.ca.comcast.net.* + Return to chat. `03-…` |
| 1f | Return to chat → TUI turn in timeline; native composer | **FAIL** | A: failed `terminal_handle_stale` with recoverableOwner tui. B: auto-fire reverse failed to `manual-recovery` / owner none. TUI turns never imported into chat |
| 1g | Full cycle ×2, no duplicate/lost items | **FAIL** | Zero complete native→TUI→native cycles |
| 2 | Busy-path: queue + cancel + auto-fire | **PARTIAL** | **Queue PASS** — Session B reverse after-turn → `phase:queued` with operationId (busy 0–12). **Auto-fire start PASS** — advanced queued → waiting-for-exit without second click (busy 13). **Auto-fire complete FAIL** — then failed manual-recovery / recoverableOwner none. **Cancel-queued:** not re-exercised this run (prior round PASS via RPC) |
| 3 | Failure-path: one recoverable owner + Retry | **FAIL (mixed)** | **A PASS:** reverse fail left `owner:tui`, `recoverableOwner:tui`, UI Retry, no Open agent TUI (no dual-writer). Retry re-attempts waiting-for-exit. `04-…`. **B FAIL:** reverse fail left `owner:none`, `recoverableOwner:none`, `stage:manual-recovery` — **not** exactly one recoverable owner. `06-…` |
| 4a | Mobile banner while desktop owns TUI | **NOT EXERCISED** | Tip Electron isolated profile; mobile pairing to tip host not established. Desktop banner parity observed |
| 4b | Return-to-chat from mobile | **BLOCKED** | Depends on 4a + reverse path |
| F | Forward regression (tab_not_found) | **PASS** | Multiple successful forwards to stable owner:tui without tab_not_found |

---

## Live transfer traces

### Session A — `desktop_msoxgqy46d41cefa`
1. Native turn `CYCLE1_NATIVE_OK` → owner native idle  
2. Open agent TUI → owner **tui** idle; handle `term_ac7c5dd6-…`, tab `000c2a11-…`  
3. TUI turn `CYCLE1_TUI_OK` in Codex UI; banner on chat view  
4. Return to chat → `waiting-for-exit` / preparing  
5. TUI exit attempts → **failed** `terminal_handle_stale`; recoverableOwner **tui** + Retry  
6. Retry → re-enters waiting-for-exit; never native idle  

### Session B — `desktop_msoy0aq716e4ee65`
1. Native turn `CYCLE2_NATIVE_OK` → owner native idle  
2. Open agent TUI → owner **tui** idle within ~4s; handle `term_f527844b-…`, tab `739c157d-…`  
3. Busy TUI prompt + Return (UI after-turn) → **queued** (PASS)  
4. Auto-advance **queued → waiting-for-exit** without second click (PASS auto-fire *start*)  
5. Then **failed** preparing: owner **none**, stage **manual-recovery**, recoverableOwner **none**, details *agent terminal could not verify its Codex session*  
6. Chat shows "previous session unavailable, started fresh"  

---

## Environment notes

- Production/orchestration Orca remained separate; tip Electron isolated user-data on CDP 9520.  
- Codex binary live (v0.147.0); account from user `~/.codex`.  
- Forward readiness + rollout proof + tab binding work.  
- Reverse blockers:  
  - Idle reverse can fail `terminal_handle_stale` after TUI process/shell exit race.  
  - Queued after-turn **does** drain to waiting-for-exit, but completion path can wipe ownership to **none** (manual recovery) when Codex session verification fails — worse than single-owner recoverable failure.  

## Recommendation

1. **Fix reverse completion** after `waiting-for-exit`: ensure process exit + transcript proof always leave **exactly one** recoverable owner (`tui` or `native`), never `none`/manual-recovery for a still-resumable Codex thread.  
2. **Hard-fail** any handoff path that would publish `recoverableOwner: none` when a terminal handle or rollout identity is still recoverable.  
3. **Re-run matrix** requiring: 2× full idle cycles with TUI markers in restored chat timeline; busy queue + cancel + auto-fire to native idle; provoked fail with single owner + successful Retry; mobile banner + Return against tip host.  
4. Until reverse completion is green with single-owner failure invariants: **NO-GO**.

---

## Artifact index

| Path | Description |
|------|-------------|
| `screenshots/` | Full CDP screenshot sequence |
| `evidence-labeled/` | Labeled GO/NO-GO evidence set |
| `electron-launch.log` | Tip Electron launch log |
| `qa-report.md` | This report |
