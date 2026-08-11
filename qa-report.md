# FINAL QA MATRIX RERUN ROUND 4 — PR 13790 native chat ↔ TUI toggle (Codex)

**SHA under test:** `c0f6e427d31a` (`c0f6e427d31a79c49bc2875204283e6642cdc95e`)  
**Branch:** `brennanb2025/native-chat-toggle`  
**Date (local):** 2026-08-11 ~16:30 PDT  
**Method:** Tip Electron via CDP only (`agent-browser --cdp 9535`), DOM clicks + PTY write for TUI turns + screenshots. No OS Computer Use / AppleScript / HID. Mobile via iOS Simulator + `orca emulator` (AX/tap) + Metro.  
**Profile:** `ORCA_DEV_USER_DATA_PATH=/tmp/orca-native-chat-toggle-qa-13790/round4-c0f6e427d31a/profile`  
**Tip launch:** `REMOTE_DEBUGGING_PORT=9535` + `pnpm dev` / `run-electron-vite-dev.mjs` from worktree.  
**Artifacts:** `/tmp/orca-native-chat-toggle-qa-13790/round4-c0f6e427d31a/`  
**Evidence:** `/tmp/orca-native-chat-toggle-qa-13790/round4-c0f6e427d31a/evidence-labeled/`

## Verdict: **NO-GO** (desktop reverse matrix green; mobile banner/return not green)

Round-3 reverse fixes **hold** for the primary desktop paths at this SHA:

1. **Two full native→TUI→native cycles** completed with TUI markers restored into the chat timeline (no dup/lost markers observed).
2. **Busy path:** `Returning after this turn` queues with **Cancel**, auto-fires to exit-wait on turn end, and completes to **native idle**.
3. **Provoked failure:** exactly **one** recoverable owner (`native`) + **Retry** UI; Retry succeeded to stable `owner:tui`.

**Blockers for full-matrix GO:**

- **Mobile cross-client banner + Return** could not be closed: Metro/pair infrastructure worked against *this* worktree + tip host, but by the time mobile opened structured sessions they were in **`manual-recovery`** (“Couldn't verify which runtime owns this session”), not a healthy TUI-owned banner with Return.
- Under multi-session stress (orphan PTY kills, queued reverse on dead process, concurrent tabs), **three** sessions later persisted `handoffStage: manual-recovery` with `runtimeKind: tui` — the failure mode round-3 aimed to eliminate for the busy auto-fire path. This is a residual durability risk beyond the happy-path matrix.

---

## Per-item table

| # | Item | Result | Evidence / notes |
|---|------|--------|------------------|
| 1a | Create structured Codex chat session | **PASS** | New Tab → Chat session (Codex Chat). Sessions A/B/C |
| 1b | Converse in native chat | **PASS** | `R4_A1_NATIVE_OK`, `R4_B1_NATIVE_OK`, `R4_C_NATIVE_OK` |
| 1c | Open agent TUI → real Codex TUI, same conversation | **PASS** | Forward to `runtimeKind:tui`; TUI buffer shows prior native markers; real Codex v0.147.0 |
| 1d | Type a turn in TUI | **PASS** | PTY write of `R4_A1_TUI_OK` / `R4_B1_TUI_OK` visible in buffer |
| 1e | Composer under TUI ownership via bridge | **PASS** | Native composer path suppressed while TUI owns; `Return to chat` present; chat view available |
| 1f | Return to chat → TUI turn in timeline; native composer | **PASS** | A+B: reverse to `runtimeKind:native`, stage null; both markers present in restored chat |
| 1g | Full cycle ×2, no duplicate/lost items | **PASS** | Two complete native→TUI→native cycles (A, B) |
| 2 | Busy-path: queue + cancel + auto-fire | **PASS** | Queue UI `Returning after this turn` + **Cancel** (B). Session C: busy Working → queue → auto-fire `preparing` + “Exit the agent terminal…” → PTY exit → **native idle** |
| 3 | Failure-path: one recoverable owner + Retry | **PASS** | Forward fail mid-proving (kill launched TUI): UI “Couldn't open the agent terminal — chat still owns this session” + **Retry** only (recoverableOwner native). Retry → stable tui idle |
| 4a | Mobile banner while desktop owns TUI | **FAIL / BLOCKED** | Metro from this worktree PASS; pair to tip Host 38 PASS; sessions opened showed **manual-recovery**, not healthy “Agent is open in terminal…” banner |
| 4b | Return-to-chat from mobile | **BLOCKED** | Depends on healthy TUI ownership surface (4a) |
| F | Forward regression (tab_not_found) | **PASS** | Multiple successful forwards without tab_not_found |

---

## Live transfer traces

### Session A — `desktop_msp9oe2d422faf47`
1. Native `R4_A1_NATIVE_OK` → native idle  
2. Open agent TUI → owner **tui** (fence 3)  
3. TUI turn `R4_A1_TUI_OK` in Codex buffer (same thread id)  
4. Return to chat → preparing / “Exit the agent terminal…”  
5. PTY kill → **native** idle (fence 5); chat shows both markers + Open agent TUI  

### Session B — `desktop_msp9vrn0819a5e08`
1. Native `R4_B1_NATIVE_OK` → Open agent TUI → tui  
2. TUI `R4_B1_TUI_OK` → reverse → **native** fence 5 with both markers  
3. Later re-open TUI for busy work; queue “Returning after this turn” + Cancel exercised  

### Session C — `desktop_mspa5goq624f827e` (busy auto-fire)
1. Native `R4_C_NATIVE_OK` → Open agent TUI  
2. Busy shell `sleep 30` turn → Working  
3. Return while busy → **queued** (`Returning after this turn` + Cancel)  
4. On turn end auto-fire → `handoffStage:preparing` + Exit chip (**no second click**)  
5. PTY exit → **native** idle fence 5  

### Failure + Retry (Session C forward)
1. Open agent TUI while aggressively killing new owned PTY during `new-owner-proving`  
2. Failure: recoverable **native**, Retry + Open agent TUI (not dual-writer / not owner none)  
3. Retry → tui idle (fence 11) with Return to chat  

### Late residual (post-matrix stress)
- Sessions A/B/C observed later as `handoffStage: manual-recovery` with `runtimeKind: tui` after orphan process / multi-session stress — **not** the clean single-owner Retry contract for still-resumable sessions.

---

## Mobile environment

| Check | Result |
|-------|--------|
| Metro cwd | `/Users/brennanbenson/orca/workspaces/orca/native-chat-toggle/mobile` port **8091** |
| Bundle | Expo bundled successfully from this worktree (4771 modules) |
| Simulator | iPhone 17 Pro (iOS 26.5) booted |
| Pairing | Tip WS `*:56080`; sim cannot reach Tailscale `100.81.92.103` — LAN rewrite to `ws://10.100.4.179:56080` required |
| Host | Mobile Host 38 connected to tip; sees `scratch-repo` / main |

---

## Environment notes

- Production/orchestration Orca separate; tip Electron isolated user-data on CDP **9535**.  
- Codex binary live (v0.147.0); account from user `~/.codex`.  
- Some Codex turns saw 502/proxy glitches from backend; handoff ownership still advanced.  
- TUI input via `window.api.pty.write` (xterm canvas not CDP-keyable).  

## Recommendation

1. **Ship desktop reverse happy path + busy auto-fire + single-owner Retry** — reproduced green at `c0f6e427d31a`.  
2. **Hard-fail remaining paths into `manual-recovery`** when a live PTY ownership / process identity still exists; keep exactly one recoverable owner + Retry.  
3. **Re-run mobile** with a single clean TUI-owned session (no multi-session orphan kills), LAN pairing endpoint preferred for Simulator, then capture banner + Return.  
4. Until mobile banner/Return is green **and** manual-recovery is not sticky under process death: **NO-GO** for full matrix.

---

## Artifact index

| Path | Description |
|------|-------------|
| `round4-c0f6e427d31a/screenshots/` | Full CDP + sim screenshot sequence |
| `round4-c0f6e427d31a/evidence-labeled/` | Labeled GO/NO-GO evidence set |
| `round4-c0f6e427d31a/electron-launch.log` | Tip Electron launch log |
| `round4-c0f6e427d31a/logs/mobile-emulator.log` | Metro/emulator launch (this worktree) |
| `qa-report.md` | This report |
