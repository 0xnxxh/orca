# Phase 2 Git upstream-status in-flight sharing — 2026-07-30

## Decision

Retain in-flight-only upstream-status sharing at both physical owners. Ten concurrent identical
local callers now share one four-command Git chain, and ten concurrent identical SSH callers share
one `git.upstreamStatus` RPC. No settled result, rejected result, Git command, RPC method, payload,
or max-lines policy changed.

Checkpoint: `6fee674c48a6dc5742156f70e1fa1363a760f6c6`.

## Ownership and identity

`GitUpstreamStatusReadOwner` is the concrete bounded joinability owner. The native/WSL path uses
one module-owned instance, keyed by:

- native versus the exact WSL distro;
- worktree path;
- configured-upstream versus explicit-target mode; and
- explicit target `remoteName`, `branchName`, `remoteUrl`, and `remoteCreated`, preserving absent
  versus explicit `false`.

Each `SshGitProvider` owns a separate instance, keyed by worktree path and the same complete target
identity. Provider replacement or reconnect therefore cannot reuse another connection
incarnation's work. The shared primitive removes successful and failed entries after settlement
and bounds joinability to 128 entries and 30 seconds; it does not retain a status result.

The existing local `runWithGitReadCacheInvalidation` and SSH `runWithGitReadInvalidation` wrappers
invalidate upstream joinability before and after every existing Git mutation. Already-issued
promises remain valid, while reads admitted before, during, and after a mutation use separate
generations.

## A/B physical-call measurement

The opt-in deterministic benchmarks call the actual local and SSH provider entry points with ten
concurrent identical callers. Counts are taken at the mocked physical `gitExecFileAsync` and mux
request boundaries.

| Arm                  | Local physical Git calls | SSH `git.upstreamStatus` RPCs |
| -------------------- | -----------------------: | ----------------------------: |
| A — checkpoint       |                       40 |                            10 |
| B — retained sharing |                        4 |                             1 |
| Change               |                      -36 |                            -9 |

The local command histogram changes from ten of each command to one of each. The command vectors
and execution options are otherwise byte-for-byte equivalent:

```json
[
  {
    "args": ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "options": { "cwd": "/repo" }
  },
  {
    "args": ["rev-parse", "--abbrev-ref", "HEAD@{u}"],
    "options": { "cwd": "/repo" }
  },
  {
    "args": ["rev-list", "--left-right", "--count", "HEAD...origin/main"],
    "options": { "cwd": "/repo" }
  },
  {
    "args": ["log", "--oneline", "--cherry-mark", "--right-only", "HEAD...origin/main", "--"],
    "options": { "cwd": "/repo" }
  }
]
```

The SSH request remains exactly:

```json
{
  "method": "git.upstreamStatus",
  "payload": { "worktreePath": "/home/user/repo" }
}
```

When an explicit target exists, the existing `pushTarget` property is still present with the
unchanged object; when absent, the property remains omitted. Existing configured-upstream and
explicit-target tests continue to cover validation, remote tracking probes, URL/created metadata,
ahead/behind counts, patch equivalence, normalized errors, and no-upstream semantics.

Baseline JSON was archived at `/tmp/git-upstream-inflight-a.json` and
`/tmp/ssh-git-upstream-inflight-a.json`; retained JSON is at
`/tmp/git-upstream-inflight-b.json` and `/tmp/ssh-git-upstream-inflight-b.json`.

## Production A/B artifacts

Fresh production builds were archived outside the worktree:

- A: `/tmp/orca-phase2-git-upstream-a.vQcXwZ/out`
- B: `/tmp/orca-phase2-git-upstream-b-final.OVLh7P/out`

| Artifact               | A raw / gzip      | B raw / gzip      | Change      | A SHA-256                                                          | B SHA-256                                                          |
| ---------------------- | ----------------- | ----------------- | ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Electron main entry    | 778,457 / 174,582 | 779,267 / 174,769 | +810 / +187 | `c5992b64d59edfb9719ea2e19b2872f923253686615e53e356aeac6d3139e632` | `64526204d377f8ca634de5940d77b3f2eff1421bd7a8e7346b0ffcc189be21da` |
| Electron preload entry | 130,798 / 20,642  | 130,798 / 20,642  | 0 / 0       | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` | `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f` |

The Electron-main raw budget remains 825,109 bytes; B retains 45,842 bytes of headroom. Main,
preload, and renderer file counts remain 184, 1, and 787 respectively. Preload and all renderer
artifacts are byte-identical; the renderer manifest remains byte-identical with SHA-256
`92ad617f8c8aee6d4c4a23622f524266cbe9c93b3fe65544d1acb833dc3f0d67`.

Renderer entry measurements are unchanged:

| Entry           | Raw bytes | Gzip bytes |  JS | CSS |
| --------------- | --------: | ---------: | --: | --: |
| Renderer index  | 8,416,540 |  1,877,823 | 292 |   2 |
| Renderer popout | 4,507,253 |    984,615 |  77 |   2 |
| Renderer web    | 4,360,652 |    928,355 |  33 |   1 |

Complete A and B manifest validation found 778 records, three HTML entries, 6,247 static edges,
213 dynamic edges, and 860 emitted artifact references, with zero missing or escaping paths, zero
cross-entry imports, and zero cycles.

An initial non-retained wiring arm imported the full upstream implementation into the eager status
module and cost +6,686 main-entry raw bytes. Moving the common fence onto the named owner singleton
reduced the retained cost to +810 bytes without changing invalidation behavior.

## Validation

- Baseline provider/upstream suite: 112 passed.
- Focused owner/upstream/provider suite: 124 passed.
- Final owner/upstream/status/provider suite: 215 passed.
- Broad dedupe, upstream, remote, native/WSL status, SSH provider/dispatch, filesystem mutation,
  and runtime-routing suite: 465 passed, 1 skipped.
- `pnpm run typecheck:node`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered suppressions and no new bypass.
- Fresh A and B `pnpm run build:electron-vite`: passed.
- `pnpm run check:electron-bundle-budgets`: passed against fresh B.
- Complete renderer manifest resolution and entry-cycle validation: passed for A and B.
- `git diff --check`: passed.

## Limitations and residual risk

- Physical call counts use deterministic mocked Git and mux boundaries. They prove admission,
  exact commands, options, method, and payload, not live process startup or SSH latency.
- After the bounded primitive's 30-second joinability window, a still-hung read may be joined by no
  new callers and a fresh call may start. Existing callers remain attached to their original work.
- This tranche does not add caller cancellation to the upstream-status API and does not broaden
  into a repository snapshot service.
- No packaged live smoke was run across macOS, Linux, Windows, WSL, or SSH hosts. Existing routing,
  folder-workspace, relay, and Git 2.25-compatible command suites cover the unchanged boundaries.
