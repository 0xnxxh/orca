# Orca 1.4.163 Crash Triage Report

**Generated:** 2026-08-01  
**Source:** `#orca-crashes` (`C0B4PDCMPPT`) via agent-slack  
**Window:** Slack reports stamped `Orca Version: 1.4.163` / `1.4.163-rc.*`  
**Local artifacts:** `crash-triage/reports/*.txt`, `crash-triage/index.json`, `crash-triage/parsed.json`  
**Code checkout:** branch `1.4.163-fix-crashes` @ `v1.4.163` + ~39 later commits (does **not** include open triage PRs)

---

## Executive summary

| Scope | Count |
|---|---|
| Slack messages matching `1.4.163` crash reports | **36** |
| Body `App version: 1.4.163` (stable release) | **31** |
| RC only (`1.4.163-rc.0`) | **3** |
| Mislabeled (body says `1.4.161` / `1.4.162`) | **2** |

**Stable 1.4.163 (31 reports) collapse into 5 work clusters:**

| Priority | Cluster | n | Platforms | Fix status | Agent work item |
|---|---|---|---|---|---|
| **P0** | A — React #185 in `terminal.workbench` | 16 | macOS 11, Win 5 | Open PR [#11950](https://github.com/stablyai/orca/pull/11950) — **ship this first** | Land / verify / watch post-ship |
| **P0** | D — Renderer heap death (OOM + high-heap crash) | 3 Win OOM + 4 macOS exit=5 ≈ **7** | Win + macOS | Instrumentation only [#11954](https://github.com/stablyai/orca/pull/11954) — **root leak still unknown** | Find leak + bound growth |
| **P1** | E — Windows GPU/renderer early death (`0x80000003`) | 4 | Windows only | Partial: [#11966](https://github.com/stablyai/orca/pull/11966), [#11940](https://github.com/stablyai/orca/pull/11940). **Not fixed by #11295 on cold start** | Real Windows GPU fix / earlier fallback |
| **P2** | B — React #185 on Settings/Voice | 1 | macOS | Open PR [#11962](https://github.com/stablyai/orca/pull/11962) (causation unproven) | Validate or re-diagnose |
| **P3** | F — Renderer killed after long session / noise | 1–2 | Windows | Reporting hygiene [#11949](https://github.com/stablyai/orca/pull/11949) | Ship reporting-side only |
| (dev-only) | C2 — `useConfirmationDialog` context mismatch | 2 RC | macOS dev (`localhost:5176`) | Open PR [#11980](https://github.com/stablyai/orca/pull/11980) | Dev-only; not a release crash |
| (outliers) | Linux early crash (exit 133/135) | 2 | Linux | No diagnosis | Collect more + dmesg/minidump if possible |

**Bottom line for other agents:**  
1. **#11950 is the highest-confidence code fix** still unmerged; field data is still landing on 1.4.163.  
2. **Heap death is the largest *user-pain* group after A** and has **no root-cause fix** — only better instrumentation.  
3. **Windows GPU death is still real on 1.4.163.** Prior hope that `#11295` / `--in-process-gpu` would end GPU child deaths on every launch is **wrong**: `--in-process-gpu` applies only when safe-graphics fallback is already engaged, not on normal cold start. Field reports still show a separate GPU process dying with `STATUS_BREAKPOINT` (~1–2s after start).

---

## How to use this report (for agents)

```
crash-triage/
  TRIAGE-REPORT.md          ← this file (start here)
  AGENT-TASKS.md            ← copy-paste task briefs
  index.json                ← Slack metadata (ts, permalink, github user)
  parsed.json               ← automated clustering
  reports/<report-id>.txt   ← full crash text (downloaded)
  raw-messages/<id>.json    ← Slack message + file IDs
  download-meta.json        ← file IDs for diagnostics ndjson re-download
```

Re-download a diagnostics bundle if needed:
```bash
agent-slack file download <diag_file_id> crash-triage/diagnostics/<report-id>.ndjson
```
File IDs are in `raw-messages/<id>.json` → `files[]`.

React #185 meaning: [Minified React error #185](https://react.dev/errors/185) = **Maximum update depth exceeded** (setState loop).

Windows exit `-2147483645` = `0x80000003` = **STATUS_BREAKPOINT** (driver/ANGLE/D3D style GPU death, not a JS exception).

---

## Cluster A — React #185 @ `terminal.workbench` (P0)

### Signature
- **Reason:** `react-error-boundary`
- **Process:** `react-render`
- **boundary_id:** `terminal.workbench`
- **error_message:** `Minified React error #185`
- **error_stack (stable):**  
  `getRootForUpdatedFiber ← enqueueConcurrentHookUpdate ← dispatchSetStateInternal ← dispatchSetState ← commitHookEffectListMount ← commitPassiveMountOnFiber`
- **component_stack tops:**
  - `TerminalPaneOverlayLayer$1` — **13/16**
  - `SortableTab` — **3/16**

### Counts
| | |
|---|---|
| Reports | **16** (all body version `1.4.163`) |
| macOS | 11 (mostly arm64 25.5.0; one 27.0.0) |
| Windows | 5 |
| Heavy repeat users | **SeungGiJeong ×9**, LesleyMurfin ×2 |

### Representative reports
| Report ID | User | OS | Notes |
|---|---|---|---|
| `d9434d07-e2cd-4ce8-9b69-748636395789` | LesleyMurfin | Win 10.0.26200 | SortableTab top; **70 live panes / 72 WebGL managers / heap 1.8GB**; example Slack URL |
| `fb339a6b-2bc8-4502-8e72-0b7fa9c56b25` | LesleyMurfin | Win | Overlay top; 67 managers; heap 904MB |
| `1051d66f-0283-44aa-b195-03557a1d8ac2` | SeungGiJeong | macOS | Overlay top; repeat machine |
| `1828176e-6344-40f3-b665-fc670a0cf032` | SeungGiJeong | macOS | SortableTab top |
| `1bdb9c23-c0a8-44d3-8de7-07b977293f9d` | SeungGiJeong | macOS | Overlay top |
| `94b7fa09-f3c1-4664-bb29-e60bf87f67ff` | Kooooojun | macOS 27 | Overlay top |

Full ID list in `parsed.json` → cluster `react-185 @ terminal.workbench`.

### Root cause (best current model)
Open PR **[#11950](https://github.com/stablyai/orca/pull/11950)** (`fix/crash-a-active-terminal-repair-loop`):

1. Same terminal **tab id can appear under two worktree keys** (SSH path rename / repo re-add minting a new worktree id while stale key retains the tab).
2. `setActiveTab` used first-match `Object.entries` ownership. If the non-active worktree is scanned first, it **refuses to write global `activeTabId`**.
3. `Terminal.tsx` repair effect sees “active tab not in active worktree’s list” forever → calls `setActiveTab` again → `activeTabIdByWorktree` identity churn → **infinite loop → React #185**.
4. Reproduced end-to-end against production `react-dom` with the same stack frames. Fix: resolve ownership **preferring the active worktree** (`active-tab-owner-worktree.ts`).

**Honest limits (from the PR, still true):**
- Throwing frame is a **local `useState` in a passive effect** (victim), driven by the repair loop (driver) — not the zustand write itself.
- Competing hypothesis (cold-parking / C5) was checked: `terminal_park_verdict_churn` absent from the original 13 diagnostic bundles (2 of our later 16 do show park churn — treat as correlative noise unless proven).
- Overlay measure↔fit loop was a **prior** #185 on the same surface (fixed in [#10026](https://github.com/stablyai/orca/pull/10026), already in 1.4.163). Do not re-open that path without new evidence.

### Code touchpoints (1.4.163 tree)
| File | Role |
|---|---|
| `src/renderer/src/components/Terminal.tsx` (~757) | Repair effect → `setActiveTab(repairedTabId)` |
| `src/renderer/src/components/terminal/active-terminal-repair.ts` | `resolveRepairedActiveTerminalTabId` |
| `src/renderer/src/store/slices/terminals.ts` | `setActiveTab` owner scan (first-wins) |
| `src/renderer/src/App.tsx` | `boundaryId="terminal.workbench"` |
| PR adds | `active-tab-owner-worktree.ts` + react185 harness |

### Agent instructions — Cluster A
1. **Prefer landing/merging #11950** over rediscovering. Diff already has red/green production-stack repro.
2. If re-verifying: run  
   `npx vitest run -c config/vitest.config.ts src/renderer/src/components/terminal/active-terminal-repair-loop.react185.test.tsx`
3. After ship: watch `#orca-crashes` for new `boundary_id: terminal.workbench` + `#185` on versions **> 1.4.163**. If they continue, check for `terminal_tab_id_owned_by_multiple_worktrees` breadcrumb (added by PR).
4. Do **not** “fix” by suppressing the error boundary or silencing #185.

### Slack examples
- https://stablygroup.slack.com/archives/C0B4PDCMPPT/p1785610366162139 (`d9434d07`)
- https://stablygroup.slack.com/archives/C0B4PDCMPPT/p1785609068281149 (`fb339a6b`)

---

## Cluster D — Renderer heap death (P0)

### Signature
Two report shapes, **same underlying problem** (heap climbs until process dies):

| Shape | Reason | Exit | OS | Heap at death |
|---|---|---|---|---|
| Explicit OOM | `oom` | `-536870904` | Windows | 3.2–4.0 GB (limit 4192) |
| Soft OOM | `crashed` | `5` | macOS | 2.4–3.9 GB (limit 3168–4192) |

### Stable 1.4.163 members

**Windows OOM (3):**
| ID | User | Peak heap | Growth | Notable store counts |
|---|---|---|---|---|
| `317f5937-…` | metheoryt | 3280 MB | **+24 MB/min** over 29 min | settings=182, prCache=49, **domNodes=844, terminalElements=1** — store counters small |
| `6754f9ef-…` | metheoryt | 3226 MB | **+24 MB/min** over 29 min | Same shape; last acts = many `agent_state_changed` |
| `5aedfe74-…` | davidkwak | 3992 MB | +3.5 MB/min over ~6.7 h | **openFiles=1132**, ptyIdsByTabId=41 |

**macOS high-heap crash exit=5 (4):**
| ID | User | Peak heap | Growth |
|---|---|---|---|
| `89d0f94b-…` | duneshique | 3945 MB | +8 MB/min |
| `76c4f5b9-…` | seanssoh | 3004 MB | +13 MB/min |
| `a220f430-…` | seanssoh | 2984 MB | +9.5 MB/min |
| `5904df3e-…` | ceresair-it | 2414 MB | (shorter trail) |

### What we know
- Heap growth is **real and monotonic** in the breadcrumb trail — not a one-shot spike.
- **Store entry counts do not explain GB-scale growth** on metheoryt (tiny maps, 0–2 terminal DOM elements, <2k DOM nodes). Memory is **outside** the counted collections.
- Prior triage: breadcrumbs only counted collection *entries*, never payload sizes inside them.  
  Instrumentation PR: **[#11954](https://github.com/stablyai/orca/pull/11954)** — measures terminal output backlog, live xterm buffers, Monaco model registry. **Does not reduce memory by one byte.**

### What we do **not** know
- Which subsystem holds the gigabytes (xterm scrollback? agent transcripts? Monaco models? PR diff HTML? IPC retained buffers?).
- Whether growth is a true leak (retained after close) or unbounded-but-intentional retention (scrollback never capped).

### Agent instructions — Cluster D
1. Land **#11954** so the *next* field OOM can name the culprit.
2. In parallel, **profile a long agent session** on Windows + macOS:
   - Many agent turns, large terminal output, many open files, PR sidebar open.
   - Watch: xterm buffer sizes, Monaco `editor.getModels()`, any session-lifetime arrays of strings/buffers.
3. Hunt code patterns (project rules: unbounded session arrays holding large strings/buffers):
   - Terminal output ring / scrollback caps
   - Agent message / transcript retention
   - `openFiles` / editor model disposal
   - PR cache HTML/diff bodies (`prCache` counts are small but values may be huge)
4. Candidate guardrails even before root cause:
   - Hard cap scrollback / agent log retention
   - Dispose Monaco models when tabs close
   - Bound PR detail cache by bytes not entries
5. Treat macOS exit=5 with heap > ~2.5GB as **same cluster** as Windows OOM for prioritization.

### Outlier (exclude from leak hunt)
- `762a9391` — Slack says 1.4.163 but **body is 1.4.162**, heap only 41MB, recovery-reload loop. Different problem (false OOM / recovery).

---

## Cluster E — Windows GPU / early renderer death (P1)

### Signature
- **Platform:** `win32` only
- **Reason:** `crashed` (sometimes recovery path)
- **Exit code:** `-2147483645` (`0x80000003` STATUS_BREAKPOINT)
- **Timeline:** app_started → main_window_created → **GPU child gone** (or recovery storm) within **~1–4 seconds**
- Breadcrumb: `process_gone_suppressed (processType=GPU, reason=crashed, exitCode=-2147483645)`
- `processMetricsGpuCount: 0` at crash time (GPU already dead)

### Members (stable 1.4.163)
| ID | Notes |
|---|---|
| `a65f6e7e-…` | Classic: GPU gone ~1.7s after start |
| `12da1e71-…` | Same, ~1.8s |
| `7a02c79c-…` | Same, Win 10.0.19045 |
| `2369eabe-…` | Same exit code; recovery_reload ×3 → circuit breaker open (no GPU line in short trail, same code) |

### Critical code fact (do not re-learn the wrong lesson)

`#11295` (merged, in 1.4.163) made **safe-graphics fallback** use `--in-process-gpu`. That only runs when fallback is **already engaged**:

```ts
// src/main/startup/gpu-fallback-switches.ts
const GPU_FALLBACK_COMMAND_LINE_SWITCHES = [
  'disable-gpu',
  'disable-software-rasterizer',
  'in-process-gpu'  // ONLY on fallback path, win32
]
```

Normal cold start still uses a **separate GPU process**. These 1.4.163 field reports prove **GPU child death still happens on cold start after #11295**.

### Related open PRs
| PR | What it does | Gap |
|---|---|---|
| [#11966](https://github.com/stablyai/orca/pull/11966) | Persist GPU crash counts across launches so safe-graphics threshold can trip | Does not stop first-launch death; prior analysis: many deaths happen *already under* safe graphics on older builds |
| [#11940](https://github.com/stablyai/orca/pull/11940) | Latch safe-graphics earlier | Needs Windows validation |
| [#8239](https://github.com/stablyai/orca/pull/8239) | GPU status diagnostics | Observability only |

### Agent instructions — Cluster E
1. **Validate on a real Windows machine** (prior review noted Windows test host was unreachable — simulation only).
2. Decide product policy:
   - **Aggressive:** default Windows to software / in-process GPU (perf hit, max stability), or
   - **Reactive:** make cross-launch counting + earlier latch good enough that second launch survives.
3. Confirm whether STATUS_BREAKPOINT still occurs **with** fallback already active on 1.4.163+ (if yes, in-process-gpu is insufficient and driver/ANGLE path needs different switches or Electron upgrade).
4. Capture `chrome://gpu`-equivalent diagnostics in crash bundle (see #8239).
5. Do not mark this “fixed by 1.4.163” — field data contradicts that.

---

## Cluster B — React #185 @ `page.settings` / Voice (P2)

### Signature
- **1 report:** `331de48e-fa10-43cc-9dae-a8903b0e7029` (wajipu, macOS 25.2.0)
- boundary `page.settings`
- component stack top: **`Presence` ← … ← `VoiceSpeechModelSection` ← `VoicePane` ← `Settings`**
- stack uses `dispatchReducerAction` (not only `dispatchSetState`) during **layout** effects

### Related PR
[#11962](https://github.com/stablyai/orca/pull/11962) — coalesce voice model download progress (~8000 events × sync fs). **PR itself says causation unproven** (repros negative).

### Agent instructions
1. Read #11962 body carefully — treat as **likely hardening**, not proven fix.
2. Reproduce: Settings → Voice → trigger model download; watch for Presence/DropdownMenu loops.
3. If still open after A/D/E, add a focused react185 test around `VoiceSpeechModelSection` progress updates.

---

## Cluster F — Renderer `killed` / recovery noise (P3)

### Members
| ID | Version in body | Notes |
|---|---|---|
| `2a2d96bf-…` | 1.4.163 | Win, exit 1, heap ~105MB, long session (~8h), agents active — may be OS/user kill or GPU-adjacent; **not OOM** |
| `28f0c1e5-…` | **1.4.161** | Slack stamped 1.4.163; Utility/Network killed; **exclude from 1.4.163 product bugs** |

### Related PR
[#11949](https://github.com/stablyai/orca/pull/11949) — stop crash prompt when auto-recovery already healed.

### Agent instructions
Ship reporting hygiene; only dig deeper if killed reports dominate after A/D/E fixes.

---

## Dev-only / RC clusters (do not prioritize for release hotfix)

### C2 — ConfirmationDialog Fast Refresh (RC)
- Reports: `42d63029`, `5ee3b8b6` on **1.4.163-rc.0**, `dev=true`, `localhost:5176`
- Error: `useConfirmationDialog must be used inside ConfirmationDialogProvider` (provider is in the stack — classic dual-module context)
- PR: [#11980](https://github.com/stablyai/orca/pull/11980)
- **Not a packaged-user crash.**

### RC macOS high-heap
- `22fad47b` — 1.4.163-rc.0, exit 5, heap 1434MB, 40 panes — fold into Cluster D methodology if still seen on stable.

---

## Linux outliers (low n)

| ID | Exit | Meaning | Notes |
|---|---|---|---|
| `b1975012-…` | 133 | 128+5 SIGTRAP | Crash ~3s after start; almost no trail |
| `dc901a26-…` | 135 | 128+7 SIGBUS | ~54s uptime; heap 14MB; not OOM |

**Agent instructions:** keep as watch list; need minidumps / journalctl / GPU stack. Do not block release on n=2 without more signal.

---

## Version / data quality notes

1. **Slack stamp ≠ body version** for 2 messages (`28f0c1e5` → 1.4.161, `762a9391` → 1.4.162). Always trust **report body `App version`**.
2. **1.4.163 released** 2026-07-31 22:15 UTC (`release: v1.4.163`). All stable reports in this set are **2026-08-01** (same calendar day field soak).
3. Prior channel-wide triage (~137 reports across versions) by Neil produced PRs **#11950, #11949, #11929, #11980, #11954, #11962, #11966** — this report is the **1.4.163-only** re-cut with downloaded bodies.
4. Open triage PRs are **not merged into this worktree**. Agents fixing code should start from those PR branches or rebase onto current main.

### Open PR status (as of triage)

| PR | Title | State |
|---|---|---|
| #11950 | terminal active-tab repair → React #185 | **OPEN** |
| #11954 | heap instrumentation before OOM | **OPEN** |
| #11962 | voice download progress / settings #185 | **OPEN** |
| #11966 | GPU crash count across launches | **OPEN** |
| #11940 | latch safe-graphics earlier | **OPEN** |
| #11949 | suppress redundant crash prompt | **OPEN** |
| #11980 | confirmation dialog Fast Refresh split | **OPEN** |
| #11295 | GPU fallback uses in-process-gpu | **MERGED** (in 1.4.163) |

---

## Recommended agent work order

```
1. Agent-A  →  Merge readiness + residual review of #11950 (Cluster A)
2. Agent-D  →  Heap leak investigation using Cluster D reports + #11954
3. Agent-E  →  Windows GPU cold-start death (Cluster E) on real hardware
4. Agent-B  →  Settings/Voice #185 only if bandwidth left
5. Agent-F  →  Reporting hygiene #11949 (low risk)
```

Do **not** parallelize A and a second unrelated “terminal #185 rewrite” — you will thrash the same files.

---

## Full stable 1.4.163 inventory (31)

| Report ID | Reason | Cluster | OS | GitHub | Slack ts |
|---|---|---|---|---|---|
| a65f6e7e | crashed | E GPU | win32 | — | 1785547954.099689 |
| 331de48e | react-eb | B settings | darwin | wajipu | 1785551120.414099 |
| 79ebdb5d | react-eb | A terminal | win32 | — | 1785556206.285269 |
| bdf0db48 | react-eb | A terminal | win32 | — | 1785559031.180049 |
| 2369eabe | crashed | E GPU | win32 | — | 1785559703.565569 |
| 7a02c79c | crashed | E GPU | win32 | — | 1785559900.880449 |
| 30eb3a56 | react-eb | A terminal | win32 | — | 1785561267.926999 |
| dc901a26 | crashed | Linux outlier | linux | — | 1785562102.200599 |
| 4501782d | react-eb | A terminal | darwin | SeungGiJeong | 1785567235.765209 |
| 6527570c | react-eb | A terminal | darwin | SeungGiJeong | 1785568528.205549 |
| 89d0f94b | crashed | D heap | darwin | duneshique | 1785569577.428249 |
| b0512e60 | react-eb | A terminal | darwin | SeungGiJeong | 1785570667.041949 |
| c7d415a7 | react-eb | A terminal | darwin | mingi115 | 1785574246.649829 |
| 387d1c98 | react-eb | A terminal | darwin | SeungGiJeong | 1785575573.484929 |
| 1051d66f | react-eb | A terminal | darwin | SeungGiJeong | 1785576669.557079 |
| 76c4f5b9 | crashed | D heap | darwin | seanssoh | 1785587435.169669 |
| 1828176e | react-eb | A terminal | darwin | SeungGiJeong | 1785588980.776189 |
| ff40fed8 | react-eb | A terminal | darwin | SeungGiJeong | 1785589796.446019 |
| 94b7fa09 | react-eb | A terminal | darwin | Kooooojun | 1785591389.335559 |
| 5904df3e | crashed | D heap | darwin | ceresair-it | 1785592622.678079 |
| cedc3d1b | react-eb | A terminal | darwin | SeungGiJeong | 1785594165.788799 |
| 1bdb9c23 | react-eb | A terminal | darwin | SeungGiJeong | 1785595141.262669 |
| 12da1e71 | crashed | E GPU | win32 | — | 1785596574.487339 |
| a220f430 | crashed | D heap | darwin | seanssoh | 1785599481.385549 |
| 6754f9ef | oom | D heap | win32 | metheoryt | 1785599931.901659 |
| 317f5937 | oom | D heap | win32 | metheoryt | 1785606662.103009 |
| 5aedfe74 | oom | D heap | win32 | davidkwak | 1785606869.260479 |
| fb339a6b | react-eb | A terminal | win32 | LesleyMurfin | 1785609068.281149 |
| b1975012 | crashed | Linux outlier | linux | — | 1785609597.365889 |
| d9434d07 | react-eb | A terminal | win32 | LesleyMurfin | 1785610366.162139 |
| 2a2d96bf | killed | F noise | win32 | — | 1785610982.772139 |

Permalink pattern: `https://stablygroup.slack.com/archives/C0B4PDCMPPT/p{ts_without_dot}`

---

## Appendix — quick local commands

```bash
# List clusters
python3 -c 'import json; d=json.load(open("crash-triage/parsed.json"));
print({k:len(v) for k,v in sorted(d["clusters"].items(), key=lambda x:-len(x[1]))})'

# Show one report
less crash-triage/reports/d9434d07-e2cd-4ce8-9b69-748636395789.txt

# Compare v1.4.163 GPU path
git show v1.4.163:src/main/startup/gpu-fallback-switches.ts
```
