# P1 vs `crash-c4-gpu-fallback` — quick assessment

**Date:** 2026-08-01  
**Question:** Can `~/Documents/projects/orca/crash-c4-gpu-fallback` fix Cluster E (Windows GPU cold-start STATUS_BREAKPOINT on 1.4.163)?

## Short answer

**Yes, partially — it is the strongest existing fix for the *recurring* Windows GPU death loop, but it does not prevent the first cold-start death on a machine that has never fallen back.**

It is **more ambitious than** #11966 / #11940 and **more honest about** why 1.4.163 still dies after #11295.

## What c4 changes (PR [#10624](https://github.com/stablyai/orca/pull/10624))

| Change | Effect on P1 field signature |
|---|---|
| **Escalation ladder** instead of single latch | After crashes under tier 1 (`--disable-gpu`), climb to **tier 2** |
| **Tier 1:** `--disable-gpu` | Same weakness as old safe-graphics: GPU child still spawned for Viz compositor; vendor driver still loads — **matches “57 deaths already under safe graphics”** |
| **Tier 2:** + `--disable-gpu-compositing` + `--use-angle=swiftshader` | Stops compositor on GPU child; keeps broken D3D11 vendor DLL out of ANGLE path — **this is the actual remediation for STATUS_BREAKPOINT init kills** |
| **Dropped `--in-process-gpu` from ladder** | Explicit design: in-process turns recoverable GPU-child faults into **main-process** kills. 1.4.163 fallback *added* in-process; c4 removes that rung |
| **Version-independent required-tier history** | After app update, resume at known-good tier instead of replaying full crash loop (#11295-era marker was version-scoped and re-armed hardware) |
| **Stop suppressing GPU crashes when fallback failed** | Field visibility + allow escalation path when tier is ineffective |
| **Marker durability / cache purge / driver identity** | Hardening so fallback is not silently lost mid-loop |

## Map to 1.4.163 Cluster E reports

Field shape (from triage):  
`app_started` → ~1–2s → `processType=GPU` gone, exit `-2147483645` (`0x80000003`) → renderer dies. Separate GPU process still present on cold start.

| Scenario | Fixed by c4? |
|---|---|
| First launch ever, no crash history, hardware GPU | **No** — still starts at tier 0; will still die once |
| Burst of GPU crashes → engage tier 1 only (old 1.4.163 path) | **Partial** — tier 1 alone often **still dies** (c4 evidence: 20/21 crashed launches already on tier 1) |
| After tier 1 fails, escalate to tier 2 | **Yes (intended)** — SwiftShader + no GPU compositing |
| Update ships → marker invalid → full crash loop again | **Yes** — required-tier history resumes known tier |
| Safe-graphics already on but still STATUS_BREAKPOINT | **Yes if can escalate to tier 2**; old single-tier could not |

So c4 **mitigates the unbootable machine** (N≥2 launches), not the **first** death.

## Relation to other open PRs

| PR | Role vs c4 |
|---|---|
| [#11966](https://github.com/stablyai/orca/pull/11966) cross-launch crash counting | **Complementary / possibly subsumed** — helps engage fallback when deaths are 1–2 per launch. c4 still needs a trigger; counting helps tier 1 engage sooner. Tier 2 is still required once engaged. |
| [#11940](https://github.com/stablyai/orca/pull/11940) earlier safe-graphics latch | **Complementary** — shrinks the window before first fallback. Does not fix “still dies under disable-gpu”. |
| [#11295](https://github.com/stablyai/orca/pull/11295) in-process-gpu on fallback | **In tension with c4** — c4 **removes** in-process-gpu from the ladder as too dangerous. Do not ship both strategies blindly. |

## Functionality / performance risks (for Codex review)

**Functionality**
- Infinite relaunch if escalation bug or marker never advances
- macOS/Linux must remain no-op
- Dropping in-process-gpu: if tier 2 insufficient on some GPUs, ladder ends in “exhausted / degraded” — need clear UX
- Concurrent mid-rebase mess in worktree was cleaned once; watch branch state

**Performance**
- Tier 2 SwiftShader: real GPU perf regression (acceptable for “app won’t start”)
- `getGPUInfo` / cache purge: must stay off healthy launch hot path (c4 claims lazy/bounded)
- Disk I/O for markers on crash path only

## Orchestration (started under this parent)

| Worktree | Parent | Agent | Task |
|---|---|---|---|
| `crash-c4-gpu-fallback` | `1.4.163-fix-crashes` | codex gpt-5.6-sol xhigh | `task_32dcf86b518d` primary review |
| `crash-e-11966-gpu-count` | same | codex gpt-5.6-sol xhigh | `task_49c59d35f1fa` compare #11966 |
| `crash-e-11940-safe-graphics-latch` | same | codex gpt-5.6-sol xhigh | `task_e4a7f7031a71` compare #11940 |

**Run:** `run_9d85df5a1e7d`

```bash
orca orchestration task-list --run run_9d85df5a1e7d --json
orca orchestration check --run run_9d85df5a1e7d --wait --types worker_done,escalation,question --timeout-ms 900000 --json
```

## Recommendation (pending worker evidence)

1. Prefer **c4 ladder (#10624)** as the structural P1 fix over counting-only #11966.
2. Keep **#11966 / #11940** as engagement accelerators if they still add value after c4 lands.
3. Do **not** expect zero GPU deaths on first launch without a different product choice (default software GPU on Windows).
4. Validate on **real Windows** hardware — prior reviews simulated macOS-only.
