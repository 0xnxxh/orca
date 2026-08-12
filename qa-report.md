# Sanity QA — PR 13790 @ `6456b4cb5afd`

**SHA under test:** `6456b4cb5afd18c3851a9f4801aeedf64610f534`  
**Branch:** `brennanb2025/native-chat-toggle`  
**Date (local):** 2026-08-11 ~22:55 PDT  
**Method:** Tip Electron CDP only (`agent-browser --cdp 9535`). Mobile via iOS Simulator + `orca emulator` + Metro from **this** worktree (`native-chat-toggle/mobile` :8091). No OS Computer Use / AppleScript / HID.  
**Profile:** `ORCA_DEV_USER_DATA_PATH=/tmp/orca-native-chat-toggle-qa-13790/sanity-6456b4cb5afd/profile`  
**Prior baseline:** Full matrix **GO** at `7316ac3926`. This run reconfirms no regression after 4 recovery-path fixes.

## Verdict: **GO**

| # | Item | Result |
|---|------|--------|
| 1 | Desktop one round-trip: Open agent TUI → same conversation → Return → no dup/lost, native idle | **PASS** |
| 2a | Metro from THIS worktree | **PASS** (:8091, cwd `.../native-chat-toggle/mobile`) |
| 2b | Mobile pair (Host 41, LAN `ws://10.0.0.4:6769`) | **PASS** |
| 2c | Banner *Agent is open in terminal* while TUI owns | **PASS** |
| 2d | Mobile Return → native idle (via TUI process exit) | **PASS** |
| 2e | No sticky manual-recovery after clean reverse | **PASS** |

### Desktop (`desktop_mspnwq4d9dfe6b8a`)
1. Native markers `SANITY_DESK_NATIVE_OK` / `SANITY_DESK_NATIVE_ACK`.
2. Open agent TUI → `owner:tui` idle; real Codex 0.147.0 resumed **same thread** `019ff47e-0834-73a3-b225-ce88341e15eb` with prior messages in buffer.
3. TUI markers `SANITY_DESK_TUI_OK` / `SANITY_DESK_TUI_ACK` in PTY.
4. Return to chat + TUI PTY/shell exit → `owner:native` `phase:idle` fence 5; chat shows all 4 markers once (ACK token also appears in user prompt text only); **Open agent TUI** restored; no Retry/manual-recovery.

### Mobile
1. Host 41 paired over LAN; sees QA-SCRATCH / main.
2. With stable TUI ownership: banner *Agent is open in terminal on Brennans-MacBook-Pro.local* + **Return to chat**; transcript shows all 4 markers.
3. Return → Cancel-available queued reverse (after-turn path) → TUI owner process exit → `owner:native` fence 9, `handoffStage:null`.
4. Mobile post-return: **Open agent TUI**, no sticky banner/recovery.

### Environment
- CDP `9535`, Codex 0.147.0, iPhone 17 Pro (iOS 26.5), Metro :8091 from this worktree.

**Artifacts:** `/tmp/orca-native-chat-toggle-qa-13790/sanity-6456b4cb5afd/`
