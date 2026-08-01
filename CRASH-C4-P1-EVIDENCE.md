# Crash C4 / Cluster E P1 evidence

## Verdict

The current worktree is a reactive recovery ladder, not a first-launch prevention mechanism. It cannot stop the first GPU fault on a machine with no marker, and the published PR's original three-crash threshold would not engage for the three representative 1.4.163 launches that expose only one GPU child death before the renderer disappears. This review adds a narrow fix for the field signature: Windows GPU `STATUS_BREAKPOINT` (`0x80000003`, signed `-2147483645`) now engages on the first observed GPU child event and skips tier 1, which is already known to leave the problematic GPU child path intact. Other crash shapes retain the three-in-30-seconds threshold and the normal `1 -> 2` ladder.

After the user accepts the native restart prompt for this signature, the next launch uses tier 2. Tier 2 is the first rung intended to bypass the vendor driver, but it still needs real Windows validation.

## Reviewed inputs

- PR #10624 body and published head `c5539df5174f1f5d63d6103caab863c90fa9a455`.
- Current worktree at `21608a875b9428230565015c009959d0fb483e38` before this review's uncommitted fix.
- `src/main/startup/gpu-fallback-tiers.ts`, marker, required-tier history, cache purge, process-gone decision/classification/recorder, GPU identity capture, restart prompt, and `src/main/index.ts` wiring.
- Parent triage report Cluster E and reports `a65f6e7e`, `12da1e71`, `7a02c79c`, and `2369eabe`.

The GitHub PR is behind this worktree. The published head has seven feature commits; the worktree also includes the later persistence/auto-recovery, marker durability, and lazy GPU capture changes (`8843199afb`, `a1ed1e8fe6`, `21608a875b`, rebased onto newer `main`). In particular, the PR body still says `getGPUInfo('complete')` is captured at startup, while the current worktree makes healthy launches lazy.

## Field signature

| Report     | Windows build |   Time from main-process start to failure | Evidence available to the GPU ladder                                                           |
| ---------- | ------------: | ----------------------------------------: | ---------------------------------------------------------------------------------------------- |
| `a65f6e7e` |    10.0.26200 |                                   1.718 s | One `child/GPU/crashed/-2147483645`, then no renderer in metrics                               |
| `12da1e71` |    10.0.26200 |                                   1.771 s | One `child/GPU/crashed/-2147483645`, then no renderer in metrics                               |
| `7a02c79c` |    10.0.19045 |                                   1.300 s | One `child/GPU/crashed/-2147483645`, then no renderer in metrics                               |
| `2369eabe` |    10.0.19045 | renderer recovery storm starts at 1.588 s | No GPU child event in the short trail; three renderer reloads and the renderer circuit breaker |

All four reports are labeled as renderer crashes because that is the user-visible failure. The first three nevertheless have an explicit suppressed GPU child breadcrumb. They do not provide the three same-process GPU events required by the original tracker, so the pre-review code could leave every cold start permanently below threshold.

## Change-to-outcome map

| Change                                                            | First cold launch with no marker                                                                            | Later launch                                                                                             | Cluster E assessment                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| First-event `STATUS_BREAKPOINT` trigger added in this review      | Does not prevent the fault; opens the existing native restart path after the first explicit GPU child event | Floors the restart at tier 2 instead of waiting for two more child deaths or spending a launch on tier 1 | **Mitigates 3/4 samples**; no effect when only a renderer event is observable                              |
| Tier 1: `disable-gpu` plus `app.disableHardwareAcceleration()`    | No effect before a marker exists                                                                            | Degrades rendering, but Chromium may still spawn a GPU child                                             | **Weak mitigation** and now skipped for the exact Cluster E signature; retained for other GPU crash bursts |
| Tier 2: add `disable-gpu-compositing` and `use-angle=swiftshader` | No effect before escalation                                                                                 | Intended to remove GPU compositing and bypass the vendor D3D/ANGLE path                                  | **Potential prevention on the later launch**, not validated on affected Windows hardware                   |
| Drop `in-process-gpu`                                             | No first-launch effect                                                                                      | Keeps a GPU child fault from becoming a main-process kill                                                | **Risk reduction**, but removes the only prior switch that guaranteed no separate GPU child                |
| Build-scoped marker read before `whenReady()`                     | No effect until a prior launch writes it                                                                    | Applies the selected tier early enough for Electron                                                      | **Prevents re-entering hardware within the same build**, subject to a readable marker                      |
| Atomic marker write, canonical path, unreadable-file preservation | No first-fault effect                                                                                       | Reduces torn/path-mismatch re-arming of hardware                                                         | **Mitigates recurrence/races**, not the initial death                                                      |
| Version-independent required-tier history                         | No effect on the first-ever failure; a new build still gets a hardware probe                                | After that probe fails, resumes the strongest previously required tier                                   | **Reduces repeated ladder walking**, but does not prevent the first post-update fault                      |
| GPU/shader cache purge                                            | No first-fault effect                                                                                       | May stop a new tier replaying driver-written cache state                                                 | **Mitigates a possible recurrence**, causation not established in these four reports                       |
| Record GPU crashes under an active fallback                       | No prevention; hardware-path GPU churn remains suppressed                                                   | Makes failed tiers visible and feeds driver/tier data to crash reports                                   | **Observability only**                                                                                     |
| GPU identity capture                                              | No prevention                                                                                               | Gives vendor/device identity for GPU or renderer reports when capture succeeds                           | **Observability only**; current worktree is lazy, unlike the PR body                                       |
| Three-report budget and fallback-specific dialog wording          | No prevention                                                                                               | Bounds disk churn and describes the degraded restart accurately                                          | **Operational/UX only**                                                                                    |
| IntensiveWakeUpThrottling separation                              | No GPU outcome                                                                                              | Preserves notification timer behavior under fallback                                                     | **Unrelated to Cluster E**                                                                                 |

## Launch-by-launch behavior after this review

1. First-ever hardware launch can still lose its GPU child. For the explicit Cluster E exit code, the first child event now trips the native restart prompt rather than waiting for three events.
2. Accepting restart writes tier 2, records required-tier history, purges caches, schedules relaunch, and exits after at most 750 ms of grace for the triggering report.
3. If tier 2 also fails, the ladder records exhaustion and does not relaunch again. The tracker also engages at most once per process.
4. Other GPU crash signatures retain the conservative `hardware -> tier 1 -> tier 2` path.
5. On a later app/Electron update, the build marker is deliberately stale. The first hardware launch can fail again; after that event, required-tier history can resume directly at the strongest recorded tier.

This means the change can turn the explicit Cluster E cold-start loop into a bounded, user-mediated recovery with one restart, but it does not honestly make launch 1 crash-free.

## Functionality review

### Escalation and relaunch bounds

- Before this review, the per-process threshold was the main P1 gap for the new samples: each of the three explicit GPU reports shows one event, not three.
- The narrow immediate trigger is limited to the signed or unsigned representation of `0x80000003`. Other GPU crashes keep the conservative rolling threshold, and non-Windows events never call the handler.
- Relaunching is bounded: one tracker engagement per process, tiers `1 -> 2 -> exhausted`, and no tier above 2.
- Choosing **Keep Running** or a prompt failure writes no marker. The tracker stays engaged for that process, so it will not prompt again until a later app launch. This is intentional user mediation, but it also means fallback is not guaranteed.
- The exact fatal signature floors the first restart at tier 2 because tier 1 leaves the known-failing child path intact. Other signatures retain the conservative first rung.

### Marker and persistence safety

- The marker is read from the canonical user-data path before `whenReady()` and written to the same path after `app.setName()`, closing the prior path mismatch.
- Temp-write, file `fsync`, and rename prevent a normal crash from exposing torn JSON. Single-instance locking and the tracker's one-engagement rule give one intended writer per process.
- An unreadable marker is retained but not applied. A transient `EPERM`/`EBUSY` therefore does not destroy recovery state, but that launch still re-enters hardware and can crash.
- Scheme v3 treats an older v2 marker as invalid. Because 1.4.163 did not write required-tier history, the first upgrade to this code still gets a hardware trial; this follows the existing per-build probe policy but is not first-update prevention.
- Required-tier persistence is a hint and is not fsynced. Failure or corruption costs extra recovery launches rather than creating a relaunch loop.

### Main-process and platform safety

- No ladder tier uses `in-process-gpu`, so a GPU CHECK remains isolated from the main process. The tradeoff is that tier 1 still leaves the problematic child architecture intact.
- Marker application, crash candidacy, history reset, and escalation are all Windows-gated. macOS and Linux do not receive tier switches, marker I/O, cache purge, or relaunches.
- The crash recorder's lazy GPU identity path does run for renderer/GPU reports on other desktop platforms, but only after a crash; it is not healthy-launch GPU work.
- Headless serve neither registers GPU identity capture nor participates in the Windows fallback.
- `2369eabe` remains outside the ladder because its short trail has renderer `STATUS_BREAKPOINT` events only. Treating every renderer breakpoint as a GPU fault would be unsafe without a correlated GPU signal.

## Performance review

### Healthy launches

- Current local code does **not** call `getGPUInfo()` on a healthy hardware launch. It registers a source at `whenReady()` and captures lazily on a renderer/GPU report.
- Windows performs one synchronous read of the small build marker during early startup. At 30 seconds, a clean hardware launch may perform one small synchronous required-tier read before deciding there is nothing to clear.
- macOS/Linux skip marker and required-tier work. Source registration is allocation-only.

### Fallback and crash paths

- A fallback-tier launch warms `getGPUInfo('basic')` asynchronously. The caller is bounded at 2 seconds and capture is single-flight, although Electron's underlying promise cannot be cancelled if it hangs.
- A renderer/GPU report can wait up to 2 seconds for lazy identity before persistence. Callers do not block renderer recovery on that promise; GPU relaunch waits only a 750 ms grace window.
- Marker write + `fsync`, required-tier write, and cache purge are synchronous main-thread I/O after the user accepts restart.
- `GPU_CACHE_PURGE_BUDGET_MS = 500` is a start-next-target budget, not a hard wall-clock bound. `readdirSync` or one recursive `rmSync` can exceed it, so a large/locked cache can stall the main process beyond 500 ms before relaunch.
- Purging cache can also increase the next launch's shader compilation cost. This is paid only during escalation.
- Tier 1 disables hardware acceleration; tier 2 also forces SwiftShader/software composition. Their steady-state cost is intentionally traded for survival and may be material for terminals, embedded browser content, and other WebGL surfaces.
- GPU-under-fallback reports are capped at three per launch, and existing dedupe still applies, bounding repeated crash-report JSON rewrites.

## Implemented fix and tests

Changed:

- `src/main/crash-reporting/gpu-crash-fallback-decision.ts`
- `src/main/crash-reporting/gpu-crash-fallback-decision.test.ts`
- `src/main/index.ts`

The tracker now accepts the observed exit code and treats signed or unsigned `STATUS_BREAKPOINT` as an immediate engagement signal. Escalation resolution supports an evidence-specific minimum tier, and index wiring uses tier 2 for this signature while recording it in escalation breadcrumbs/relaunch data.

Validation:

```text
10 relevant Vitest files passed
147 tests passed
Node TypeScript check passed
Targeted Oxlint passed with no warnings
Max-lines ratchet passed with no new bypasses
Formatting and git diff checks passed
```

The focused suite covers fallback decision, tiers, marker, required-tier history, cache purge, GPU identity, classification/recording, crash store, and restart prompt.

The changed-code-quality wrapper separately reported zero native and zero type-aware findings, then exited because its React Doctor stage did not return parseable Oxlint JSON. This review does not change renderer/React code.

## Windows remote validation

Orca orchestration checked out commit `0d6ea183db957d9ddf04e1536d08e3e5810afaf8` in a new top-level worktree on `windows-loca-spec` and produced these remote reports:

- `validation-artifacts/CRASH-C4-WINDOWS-VALIDATION-0d6ea183.md`
- `validation-artifacts/CRASH-C4-DEBUGBREAK-VALIDATION-0d6ea183.md`

The host was Windows 11 build 26200 with Intel HD Graphics 530 driver `31.0.101.2111` and Electron 43.1.0. Eleven focused test files passed with 148 tests and one expected Windows permission-test skip; Node/main TypeScript, targeted Oxlint, the max-lines ratchet, the source build, and `dist/win-unpacked/Orca.exe` packaging also passed. Packaging reused the matching `windows-native-registry@3.2.2` binary from the installed Orca 1.4.163 because the host had no Visual Studio C++ toolchain.

The packaged hardware launch loaded ANGLE, D3D11, and the Intel driver and stayed alive for several minutes, so the natural field fault did not reproduce. A separately seeded tier-2 marker selected `--use-angle=swiftshader`, loaded `vk_swiftshader.dll` instead of the Intel vendor modules, stayed alive for more than 80 seconds, and showed one main-process lifecycle with no relaunch loop. This proves packaged marker consumption and vendor-driver bypass, not the first-fault prompt or automatic relaunch.

A follow-up targeted only the isolated packaged GPU child with Windows `DebugBreakProcess` after revalidating its executable, parent PID, `--type=gpu-process`, and disposable `--user-data-dir`. `OpenProcess` and `DebugBreakProcess` both returned success, but Chromium kept the GPU child alive for 15 seconds; no `child-process-gone`, marker, prompt, or relaunch followed. The exact field causal chain therefore remains unvalidated without a naturally affected host or a purpose-built in-app fault hook.

The remote checkout used `core.autocrlf=true`, and its `oxfmt --check` rejected the changed worktree files. The canonical LF worktree passed `oxfmt 0.52.0 --check` on the same six files after the Windows run, so this was not treated as a source-format regression.

## Residual P1 risks

1. The Windows hardware path and tier-2 SwiftShader path were exercised, but the field `STATUS_BREAKPOINT` did not reproduce. The first-event prompt, marker write, and automatic relaunch remain unproven as one causal packaged sequence.
2. Launch 1 still experiences the fault, and recovery requires the user to accept a native restart prompt.
3. Renderer-only `STATUS_BREAKPOINT` (`2369eabe`) does not engage the GPU ladder without a GPU child signal.
4. An unreadable marker is preserved but cannot protect that launch.
5. The synchronous cache purge has no enforceable hard deadline around an individual recursive removal.
6. A build update intentionally gets one hardware probe before required-tier history is consulted, so known-bad machines can fault once per update.
