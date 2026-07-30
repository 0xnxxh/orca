# Phase 2 SSH Git status in-flight lease — 2026-07-30

## Decision

Retain per-`SshGitProvider` cancellation-safe status sharing. The arm reduces each measured
ten-call burst from ten `git.status` RPCs to one while preserving caller-scoped cancellation,
payload omission, provider incarnation isolation, and mutation fences.

Checkpoint: `480b83df123ed0003e0e27c4c58317b844e2833b`.

## Ownership boundary

Each `SshGitProvider` owns one `GitStatusReadLeaseOwner<GitStatusResult>`. The relay session
already creates a new provider around each new mux and unregisters it during teardown, so no lease
map crosses an SSH connection or relay incarnation. No dispatch-registry, relay protocol, local,
WSL, runtime-routing, or Git-command change is required.

The status key contains the worktree path and the three output-affecting provider options:

- `includeIgnored`;
- `bypassEffectiveUpstreamNegativeCache`; and
- `reuseLineStats`.

Caller signals are intentionally excluded from the key. False or absent options retain the
existing omitted RPC fields.

## A/B RPC measurement

The opt-in deterministic benchmark issues ten concurrent identical provider calls without
signals, then ten concurrent identical calls with a distinct `AbortSignal` per caller. Counts are
physical calls to the mocked mux request boundary.

| Arm                     | Unsignalled `git.status` RPCs | Distinct-signalled `git.status` RPCs |
| ----------------------- | ----------------------------: | -----------------------------------: |
| A — checkpoint behavior |                            10 |                                   10 |
| B — provider lease      |                             1 |                                    1 |

A:

```json
{
  "scenario": "ssh-git-status-concurrent-burst",
  "concurrentCalls": 10,
  "unsignalledStatusRequests": 10,
  "signalledStatusRequests": 10,
  "method": "git.status",
  "payload": {
    "worktreePath": "/home/user/repo"
  }
}
```

B:

```json
{
  "scenario": "ssh-git-status-concurrent-burst",
  "concurrentCalls": 10,
  "unsignalledStatusRequests": 1,
  "signalledStatusRequests": 1,
  "method": "git.status",
  "payload": {
    "worktreePath": "/home/user/repo"
  }
}
```

The method remains exactly `git.status`. The default payload remains exactly
`{"worktreePath":"/home/user/repo"}`; true options are included under their existing field names,
while false and absent options remain omitted. No relay method or Git command changed.

## Cancellation and invalidation semantics

- Every caller receives a separate lease promise and keeps its original abort reason identity.
- First or later lease cancellation does not abort the shared signal while another lease remains.
- Cancelling the last live lease removes joinability and aborts the signal passed to the mux,
  activating its existing `rpc.cancel` behavior.
- A pre-aborted caller starts or joins no mux request.
- Result and error settlement remove the entry; the next call performs a fresh RPC.
- Every existing SSH Git mutation now uses the provider's common pre/post Git-read invalidation
  wrapper. Already-issued status promises remain valid, while reads admitted before, during, and
  after a mutation occupy separate joinability generations.
- Worktree path and all output-affecting status options are isolated. Replacement providers using
  the same connection id and providers for different connections do not share.

## Production A/B artifacts

Fresh production builds were archived outside the worktree in these ephemeral local build
directories; the recorded hashes, byte counts, and conclusions below are the durable evidence:

- A: `/tmp/orca-phase2-ssh-git-status-a.yGJXmv/out`
- B: `/tmp/orca-phase2-ssh-git-status-b.95yc1x/out`

| Artifact               | A raw / gzip      | B raw / gzip      | Change    | A SHA-256                                                          | B SHA-256                                                          |
| ---------------------- | ----------------- | ----------------- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Electron main entry    | 778,398 / 174,564 | 778,457 / 174,582 | +59 / +18 | `a9fe616bb029072812b7e67a6e450e410ec37d45a810d49e3ea6dcdd907d9da7` | `c5992b64d59edfb9719ea2e19b2872f923253686615e53e356aeac6d3139e632` |
| Electron preload entry | 130,798 / 20,642  | 130,798 / 20,642  | 0 / 0     | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` |

Sorted file/SHA-256 tree manifests:

| Tree     | A files | A tree SHA-256                                                     | B files | B tree SHA-256                                                     |
| -------- | ------: | ------------------------------------------------------------------ | ------: | ------------------------------------------------------------------ |
| Main     |     184 | `053ac8fa5fc49f1e6c3efbdb9b38f5725b17e1d3539924419de8f082dbff78e9` |     184 | `98ae6bf7b3d0c94f50532b8abfba7391c81c78518d52c98efcab4b91312e0bc2` |
| Preload  |       1 | `3bb30bdb361c7c99cc423e4a4939399f8cb29042d653bdbfe5ef582034d9ed00` |       1 | `3bb30bdb361c7c99cc423e4a4939399f8cb29042d653bdbfe5ef582034d9ed00` |
| Renderer |     787 | `4a908ad235e20cac443923a10690bee4acbe1106c1c781e903a92cad53aa1c9a` |     787 | `4a908ad235e20cac443923a10690bee4acbe1106c1c781e903a92cad53aa1c9a` |

Preload and all 787 renderer artifacts are byte-identical. Both renderer manifests are
byte-identical with SHA-256
`92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67`.

Complete A and B renderer manifest validation found:

- 778 manifest records;
- three HTML entries;
- 6,247 static edges;
- 213 dynamic edges;
- 860 emitted file/CSS/asset references;
- zero missing or escaping targets; and
- zero cross-entry imports or cycles.

The unchanged Electron-main budget is 825,109 raw bytes. B retains 46,652 bytes of headroom.
Renderer and preload budgets are unchanged.

## Validation

- Narrow provider/dispatch/lease suite: 99 tests passed.
- Final provider, dispatch, lease, mux, filesystem, IPC, and relay-session suite: 365 passed, 1
  skipped.
- Focused runtime SSH/Git routing suite: 31 passed, 866 skipped.
- `pnpm run typecheck:node`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new
  bypasses.
- Fresh A and B `pnpm run build:electron-vite`: passed with the two existing CSS parser warnings.
- `pnpm run check:electron-bundle-budgets`: passed against fresh B.
- Complete renderer manifest resolution and cross-entry-cycle validation: passed for A and B.
- `git diff --check`: passed.

## Limitations and residual risk

- RPC counts use a mocked mux boundary. They prove admission and exact payload behavior, not live
  SSH latency or process-termination time.
- Mux cancellation remains best-effort after `rpc.cancel`; a remote Git process may take time to
  terminate even though all issued caller promises have settled correctly.
- This is in-flight status sharing, not a retained repository snapshot service. Results and
  failures are never cached after settlement.
- No packaged or live SSH smoke was run across macOS, Linux, system SSH, or Windows remote hosts.
  Existing relay/session and runtime-routing tests cover those unchanged boundaries
  deterministically.
