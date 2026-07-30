# Phase 2 Git status in-flight lease — 2026-07-30

## Decision

Retain the cancellation-safe in-flight status-read lease owner for native and WSL `getStatus`.
It closes the signal-bypasses-dedupe gap without changing Git commands, status parsing, routing,
or settled-result caching.

Checkpoint: `51ccebc4767fc56c6301cc6be74ace2da7939cab`.

## Scope

The tranche adds `GitStatusReadLeaseOwner` and moves only native/WSL `getStatus` admission onto
it. SSH/provider/runtime/relay routing, folder-workspace handling outside `getStatus`, mutation
commands, the line-stat generation fence, and the broader repository-snapshot architecture are
unchanged.

Each exact status-read key includes:

- worktree path;
- WSL distro;
- `includeIgnored`;
- `reuseLineStats`;
- effective-upstream negative-cache bypass;
- resolved status limit; and
- the ordered `sharedLinkPaths` array.

The key uses `stableInFlightKey`, so structured option boundaries cannot collide through delimiter
characters.

## A/B physical invocation measurement

The benchmark issues ten concurrent identical calls against a mocked physical Git boundary. It
runs one burst without caller signals and a second burst where every caller has a distinct
`AbortSignal`. Counts include only calls whose argument vector contains `status`.

| Arm                     | Unsignalled physical status calls | Distinct-signalled physical status calls |
| ----------------------- | --------------------------------: | ---------------------------------------: |
| A — checkpoint behavior |                                 1 |                                       10 |
| B — lease owner         |                                 1 |                                        1 |

A artifact:

```json
{
  "scenario": "git-status-concurrent-burst",
  "concurrentCalls": 10,
  "unsignalledStatusCommandCalls": 1,
  "signalledStatusCommandCalls": 10,
  "statusArgs": [
    "-c",
    "core.quotePath=false",
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=all"
  ],
  "durationMs": 1.475625000000008
}
```

B artifact:

```json
{
  "scenario": "git-status-concurrent-burst",
  "concurrentCalls": 10,
  "unsignalledStatusCommandCalls": 1,
  "signalledStatusCommandCalls": 1,
  "statusArgs": [
    "-c",
    "core.quotePath=false",
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=all"
  ],
  "durationMs": 0.87337500000001
}
```

The timings are diagnostic test-harness observations, not stable performance claims. The
authoritative result is the physical invocation count.

The exact status command is identical in A and B:

```text
git -c core.quotePath=false status --porcelain=v2 --branch --untracked-files=all
```

Existing option-dependent additions such as `--ignored=matching` are unchanged. Git 2.25 command
and argument compatibility is therefore unchanged.

## Production bundle tradeoff

A fresh production build measured the implementation cost against the checkpoint build:

| Entry         |      A raw / gzip |      B raw / gzip |        Change |
| ------------- | ----------------: | ----------------: | ------------: |
| Electron main | 776,873 / 174,092 | 778,398 / 174,564 | +1,525 / +472 |
| Preload       |  130,798 / 20,642 |  130,798 / 20,642 |         0 / 0 |

The main tree retained 184 files. Its sorted tree hash changed from
`84c77a9f3530cff5ddf7b9cbb4f9e088f0bd07430aa2685393e576500fb0dd5a` to
`a0a4f15396e3204ac7bf2ceede5f944fec4aa85111b52f75e54911488eec2cb1`; `index.js` changed
from SHA-256 `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd` to
`a9fe616bb029072812b7e67a6e450e410ec37d45a810d49e3ea6dcdd907d9da7`.

Preload and all 787 renderer files were byte-identical to A. Renderer manifest validation
retained 778 entries, 6,247 static edges, 213 dynamic edges, 860 emitted references, zero missing
targets, and zero cross-entry cycles.

The 1,525-byte main-entry cost is retained because it removes nine duplicate physical status
pipelines in the measured ten-caller case. The 825,109-byte main budget is unchanged and preserves
46,711 bytes of headroom.

## Lease semantics

- Identical callers share one underlying `AbortController` and one physical status read.
- Each caller receives a separate promise and listener. Cancelling a first or later caller rejects
  only that caller with its original abort reason while another live lease remains.
- Cancelling the last live lease removes joinability and aborts the underlying read with that
  caller's reason.
- A pre-aborted caller rejects with its existing reason without starting or joining work.
- Success, failure, and cancellation remove caller listeners. Underlying settlement removes the
  identity-matched map entry, so the next read is always physical and failures are not retained.
- Cache invalidation clears joinability without rejecting already-issued leases. Reads admitted
  before, during, and after a mutation occupy distinct generations; settlement from an older
  generation cannot remove a newer entry.

Focused tests cover first and later cancellation, all-caller cancellation, pre-abort, success and
failure cleanup, listener removal, post-settle fresh reads, mutation invalidation, and isolation
across every key dimension listed above.

## Validation

- Focused lease-owner and status tests: 97 passed.
- All status/cache/path/mutation suites plus shared in-flight dedupe and filesystem cancellation
  suites: 305 passed, 1 skipped.
- `pnpm run typecheck:node`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- Fresh `pnpm run build:electron-vite`: passed with only the two existing CSS parser warnings.
- `pnpm run check:electron-bundle-budgets`: passed against the fresh build (Electron main 778,398
  raw bytes; preload 130,798; renderer index 8,416,540; popout 4,507,253;
  web 4,360,652).
- `git diff --check`: passed.

## Limitations and residual risk

- This is intentionally an in-flight status-read owner, not a cached repository snapshot service.
  Settled reads are never reused.
- Underlying Git cancellation is best-effort at the existing runner boundary. Issued caller
  promises remain isolated even if a platform process takes time to terminate.
- The deterministic benchmark uses a mocked Git boundary; it proves admission counts and argument
  identity, not live-repository wall-clock or process-termination latency.
- Native and WSL status paths are covered. SSH/provider status ownership remains unchanged and
  intentionally outside this tranche.
