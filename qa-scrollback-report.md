## Electron QA — attention-based scrollback retention (post design change)

**Build under test:** `0df7989556` on `brennanb2025/daemon-scrollback-budget`  
**CDP identity verified:** `devLabel=pr-13061-scrollback-budget @ brennanb2025/daemon-scrollback-budget`, `devRepoRoot=.../pr-13061-scrollback-budget`  
**Method:** isolated `ORCA_DEV_USER_DATA_PATH` Electron dev instance on CDP `:9333` / renderer `:5180`. Depth checked via `window.api.pty.getMainBufferSnapshot(ptyId, { scrollbackRows: 5000 })` plus full-window screenshots. No product code changed.

### 1) Headline — actively used terminal keeps full history with 30+ sessions ✅

- Filled **Terminal 1** with numbered lines `QA_LINE_0001` … `QA_LINE_4500` while viewing.
- Opened **32 additional terminals** → **34 live sessions** total.
- Daemon snapshot after mass-create and after re-selecting Terminal 1: still **4500/4500** markers, `has0001=true`, `has4500=true`.
- UI scroll-to-top on Terminal 1 with all 34 tabs still open: **earliest lines still present** (`QA_LINE_0001` visible at top of viewport).

**After fill (bottom of history):**

![qa-scrollback-01-after-fill.png](https://github.com/user-attachments/assets/fa75b61c-b597-411d-97e5-bfcfb267bf66)

**After 34 sessions + reattach + scroll to top (earliest lines intact):**

![qa-scrollback-05-headline-max-scroll.png](https://github.com/user-attachments/assets/5b063b02-6f2f-4458-b9c4-8a99086eef02)

Hard requirement satisfied: **a terminal I’m using still scrolls all the way back** with far more than 24 terminals open.

### 2) Recently-viewed reattach keeps full history ✅

- Filled **Terminal 30** with `RECENT_LINE_0001` … `RECENT_LINE_1500`.
- Switched away to Terminals 31–34, then reattached to Terminal 30.
- Daemon snapshot after reattach: **1500/1500**, `has0001=true`, `has1500=true`.
- UI scroll still shows deep recent history (screenshot mid-scroll; daemon snapshot is the full-depth proof):

![qa-scrollback-04-recent-t30.png](https://github.com/user-attachments/assets/8cc7f39a-cc41-43a2-a2bf-c165075373cd)

- Terminal 3 (filled earlier with 2500 `PARK_LINE_*` markers) also retained **2500/2500 including 0001** while other tabs were active.

### 3) Long-parked past LRU cap → ~1000 rows ⚠️ partial (unit-tested; not forced live)

**Live Electron path:** With 34 **open** tabs in one connected client, sessions remained reachable at full depth (no live observation of a trim-to-1000). In this topology the desktop client appears to keep stream ownership for open sessions, so the “parked/detached” LRU trim does not fire merely from switching tabs.

**Daemon policy (automated):** host + pure policy tests all pass on this checkout:

- `src/main/daemon/terminal-host-scrollback-retention.test.ts` — **5/5 passed** (full depth under cap; only LRU-oldest parked trimmed past cap; attached never trimmed; reattach restores full depth going forward; freed slot returns newest trimmed to full).
- `src/main/daemon/daemon-scrollback-retention.test.ts` — **8/8 passed**.

I did **not** live-prove a real “parked past cap → reattach shows ~1000 recent rows” UI screenshot in this run. That path is covered by host tests with explicit `detach()`, not by open-tab UI.

### 4) Stability / daemon RSS at 30+ sessions ✅

- Opened/closed-switch among 34 terminals: **no crash, no stall, no freezes**.
- Daemon PID for this instance (`daemon-entry.js` under this worktree’s profile): **~101–114 MB RSS** at 34 sessions (sample ~113.7 MB near end of run). Far below the ~1.9 GB incident class. Note: most of those sessions were near-empty shells; only a few held multi-thousand-line buffers.

### 5) Regression — few-terminal full depth ✅

- Before mass-create, Terminal 1 already held full `QA_LINE_0001`…`4500` at default depth (daemon snapshot + bottom screenshot). Behavior matches pre-change expectation for normal few-terminal use.

### Not verified live

| Item | Status |
|------|--------|
| Parked-beyond-cap trim to ~1000 rows in real UI | Unit/host tests only; open tabs did not enter detached park |
| Dead client transport releases attachments so a dead client cannot pin full depth | Code path present (`detachClientSessions` on transport drop); **not exercised** in this Electron session |
| Windows host (incident platform) | macOS only |
| Multi-client (desktop + mobile) attach/park interaction | Not tested |

### Verdict

**Headline hard requirement passes** on this build: with **34** live sessions, the terminal in use retains and can scroll back to **`QA_LINE_0001`**. Recently-viewed reattach also keeps full filled history. Daemon RSS stayed modest. Parked-cap trim and transport-drop release are supported by tests/code but were **not** reproduced as live UI screenshots here — call that residual risk, not a headline regression.
