# Phase 0 subprocess/RPC evidence

## Instrumented boundaries

- Existing Git subprocess accounting remains in `src/main/git/runner.ts`; command
  classification and spawn-initiation timing are unchanged.
- `SshChannelMultiplexer.request()` records one admitted outbound relay request
  immediately before frame send. Notifications, keepalives, responses, cancel
  notifications, pre-aborted calls, and disposed calls do not add a second
  logical request.
- Runtime-environment one-shot, cached connection, shared-control, dedicated
  subscription, and shared subscription transports record once at their common
  main-process request boundary. Shared-control capability probes use the same
  boundary, so their real `status.get` round trip is visible.
- Only the stable method string is retained. Invalid or path-shaped methods use
  the `other` bucket; params, paths, hosts, environment IDs, pairing data, and
  credentials are never retained.
- With `ORCA_MAIN_THREAD_DIAGNOSTICS` disabled, each call returns after one
  environment gate and no counter entry or timer accumulates.

## Periodic report schema

Every complete diagnostic window emits:

```text
[main-thread] {
  t,
  windowDurationMs,
  maxGapMs,
  gapsOver50Ms,
  gapsOver250Ms,
  spawnCount,
  spawns: {
    "<binary operation>": { count, blockMsTotal, blockMsMax }
  },
  rpcCount,
  rpcs: {
    "<protocol method>": { count }
  }
}
```

Subprocess and RPC maps drain in the same synchronous report callback.
`windowDurationMs` is measured rather than inferred, and the benchmark waits for
the next complete report before starting its measured slice, preventing warmup
counts from leaking into evidence.

## Measured smoke evidence

Focused headless Electron E2E, 100 tracked and modified files:

- status entries: 100
- status activity: 182.13 ms
- diagnostic capture: 5,003.31 ms
- exact diagnostic window: 5,009 ms
- Git subprocesses: 6 (`git status` 1, `git symbolic-ref` 1,
  `git rev-parse` 2, `git config` 1, `git diff` 1)
- remote RPCs: 0, truthfully reflecting a local repository

The main-thread benchmark harness smoke used 100 tracked files and one complete
5.021 s headless window. It reported 0 Git subprocesses and 0 RPCs because
headless mode intentionally disables visibility-gated Source Control polling;
the sanitized artifact is
`tools/benchmarks/results/main-thread-jank-phase0-rpc-smoke-2026-07-30T00-04-54-758Z.json`.

The deterministic synthetic slow-SSH harness applies 125 ms of controlled
in-memory transport latency. It reports 125 ms elapsed and 3 logical requests:
`git.status`, `git.history`, and `git.diff` once each; success, remote error, and
post-send cancellation remain single-counted, while a pre-aborted request is
not counted. A send failure counts its single attempted request, and a later
disposed call does not count.

Synthetic latency validates logical counter placement and outcome semantics; it
does not represent SSH negotiation, encryption, congestion, server execution,
or live-host tail latency. The large-repository evidence is a short local
fixture run, not a representative performance baseline.

## Verification

- Focused diagnostics, SSH/multiplexer/provider, runtime-provider, and benchmark
  tests: 17 files, 272 tests passed.
- Focused large-repository Electron E2E: 1 passed.
- `pnpm run build:electron-vite`: passed.
- `pnpm run check:electron-bundle-budgets`: passed without budget changes.
- `pnpm typecheck:node`: passed.
- Targeted `oxfmt` and `oxlint`: passed.
- `pnpm run check:max-lines-ratchet`: passed with no new bypasses.
- `git diff --check`: passed.

## Task files

- `src/main/diagnostics/main-thread-churn-probe.ts`
- `src/main/diagnostics/main-thread-churn-probe.test.ts`
- `src/main/diagnostics/main-thread-churn-probe-report.test.ts`
- `src/main/ssh/ssh-channel-multiplexer.ts`
- `src/main/ssh/ssh-channel-multiplexer-synthetic-latency.benchmark.test.ts`
- `src/main/ipc/runtime-environment-request-connections.ts`
- `src/main/ipc/runtime-environment-request-connections.test.ts`
- `src/main/ipc/runtime-environment-shared-control-support.ts`
- `src/main/ipc/runtime-environment-transport-routing.ts`
- `src/main/ipc/runtime-environments.test.ts`
- `tools/benchmarks/main-thread-jank-bench.mjs`
- `tools/benchmarks/main-thread-diagnostic-report.mjs`
- `tools/benchmarks/main-thread-diagnostic-report.test.mjs`
- `tools/benchmarks/benchmark-artifact-home-sanitizer.mjs`
- `tools/benchmarks/benchmark-artifact-home-sanitizer.test.mjs`
- `tools/benchmarks/startup-time-bench.mjs`
- `tests/e2e/main-thread-diagnostic-interval.ts`
- `tests/e2e/source-control-large-file-count.spec.ts`
