# Terminal session authority continuation handoff

This handoff is the restart point for the comprehensive terminal-session
authority replacement. Read the normative
[`design`](./terminal-session-authority.md) first, then the numeric
[`delivery ledger`](./terminal-session-authority-delivery.md). This document
does not weaken either one.

## Intended outcome

Replace PR #12600's containment mechanisms with one final-host authority model:

- no sliding windows, quarantine verdicts, retry-count identity decisions, or
  inference from absence;
- no duplicate app cursor, settlement ledger, receipt ledger, durable grant
  ledger, retirement-receipt ledger, or app-global failure fence;
- one exact pane-generation/PTY-incarnation binding on the final host;
- one active source delivery lease per exact host/namespace/binding, with
  provider, client, owner, and delivery generations fencing a provisional
  replacement before it can publish, ACK, or mutate;
- separate host physical-effect and authenticated app/device consumers reading
  the same ordered journal through final-host cumulative cursors;
- one bounded proof identity, host-derived principals, and namespace-local
  admission and retirement;
- one ordered, crash-resumable identity reset and re-enrollment transaction;
- stage-before-marker E2EE publication and canonical migration equality based
  on validated identity lineage rather than mutable-file byte equality;
- isolated mixed-version legacy behavior, with no authoritative fallback;
- sandboxed-preload safety enforced against every emitted preload artifact
  before build output is written, with `electron` as the sole external;
- complete macOS, Linux, Windows, WSL, daemon, SSH, paired-runtime, remote,
  folder, floating, and version-skew proof;
- net production LOC at or below zero after the replacement paths delete the
  systems they supersede.

Correctness, security, compatibility, and performance gates cannot be weakened
to reach the line-count target. Conversely, passing tests cannot justify leaving
parallel sources of truth in production.

## Numeric progress

The pause snapshot must preserve these release classifications even after both
implementation tranches are accepted:

- goalposts: **0/8 proven, 6/8 partial, 2/8 not started**;
- required journeys: **0/13 proven**;
- accepted pause tranches: a construction milestone only, never promotion of a
  release goalpost or journey.

## Pause boundary

The requested pause occurs only after all four gates are closed:

1. Host authority has a fresh adversarial audit with no unresolved owned-scope
   finding: independent host/app consumers, proof-derived daemon and SSH
   transports, namespace-local admission, exact reconnect, cumulative ACK, and
   authenticated retirement.
2. E2EE storage lifecycle has a fresh adversarial audit with no unresolved
   owned-scope finding: strict identity loading, installation marker,
   purpose-bound stages, exact successor reuse, durable replacement, canonical
   lifecycle migration, and strict registry/outbox reset loaders.
3. The frozen combined tree passes a fresh independent broad authority run,
   and that closure reconciles, rather than redundantly reruns, the already
   fresh correctness, SSH, performance, static, build, reliability, wire,
   Docker, host, and E2EE receipts.
4. The normative design, numeric delivery ledger, and continuation handoff are
   reconciled to that evidence, formatted, and independently audited.

The pause does **not** mean the comprehensive change is shippable. Identity
reset orchestration, legacy deletion/consolidation, all required journeys,
performance proof, rebase, final review, commit, push, and PR creation remain
outside this boundary.

## Repository state

- Worktree: `/Users/nwparker/orca/workspaces/orca/eye-React-185`
- Branch: `nwparker/react185-session-authority`
- HEAD and construction base:
  `a7ffb244e45fee0cb75a129aaa726ce7a2f68845`
- `origin/main` at 2026-08-07T22:04:56Z:
  `2396e5e3e583a9dd8d237602372e5b66a780e6ac`
- Branch distance at that snapshot: 0 ahead, 51 behind.
- Expanded status before documentation finalization: 801 paths—255 tracked
  entries including 10 deletions, plus 546 untracked files.
- Orchestration run: `run_2bf3603a101a`
- The worktree is intentionally dirty and contains concurrent construction
  changes. Preserve unrelated edits and the exact stash entry
  `stash@{0}: On nwparker/react185-session-authority: react185 terminal authority architecture probe before current-main rebuild`.
- No commit, push, rebase, stash mutation, or PR action occurred during pause
  closure. None is authorized until every delivery gate passes.

Categorized working-tree census against the construction base, using
`git diff --numstat --no-renames` plus full line counts for untracked files:

| Category   | Files | Additions | Deletions |     Net |
| ---------- | ----: | --------: | --------: | ------: |
| Production |   522 |    65,357 |     4,454 | +60,903 |
| Tests      |   268 |    45,936 |     2,995 | +42,941 |
| Docs       |     3 |     1,361 |         0 |  +1,361 |
| CI/config  |     8 |       382 |         3 |    +379 |

Recalculate the categorized diff census and active dispatches after the final
documentation audit; the values above are an evidence checkpoint, not a
substitute for that final read.

## Acceptance record

The final pause update must record each gate as one of:

- `accepted`: implementation, coordinator inspection, focused verification, and
  a fresh adversarial audit have no unresolved owned finding;
- `implemented, unaccepted`: the implementation worker finished but independent
  review found or has not excluded a blocker;
- `not implemented`.

| Gate                          | Pause status | Owned scope                                                                                                     | Independent audit and exact evidence                                                                                                                  | Residual limitation                                                                                      |
| ----------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Host-authority implementation | accepted     | Host/app consumers, proof-derived daemon/SSH transports, namespace admission, reconnect, cumulative ACK, retire | `/tmp/react185-host-authority-closure-acceptance.md`: 466 PTY + 168 adjacent + 7 exact-close tests; P0/P1/P2=0.                                       | No physical Windows, WSL, paired-runtime, remote-server, or two-independent-host proof.                  |
| E2EE storage lifecycle        | accepted     | Strict identity load, stage/marker/backup recovery, durable replacement, canonical lifecycle migration          | `/tmp/react185-e2ee-storage-acceptance.md`: 108 storage + 60 remote-userData + 9 regression + 8 injected-Windows tests; P0/P1/P2=0.                   | Injected Windows semantics passed; real Windows and physical power-loss durability remain unproved.      |
| Frozen combined validation    | accepted     | SSH scale fixture, authority matrix, hot path, reliability, preload/build, wire, Docker, typecheck, lint        | `/tmp/react185-final-combined-validation-closure.md`: fresh broad 829 files/8,831 tests passed; prior fresh receipts were reconciled, not rerun.      | Full release platform, journey, and production-scale gates remain unproved.                              |
| Documentation package         | accepted     | Normative design, numeric ledger, continuation handoff, categorized LOC, exact residual gaps                    | `/tmp/react185-terminal-authority-docs-audit.md`: four P2s corrected; clean final confirmation in `/tmp/react185-terminal-authority-docs-closure.md`. | Pause-only acceptance; release goalposts, journeys, LOC, platform, performance, and review gates remain. |

`accepted` means only that the named pause gate has sufficient scoped evidence
to stop and hand off. It does not mean release-ready and does not satisfy G0-G7,
any required journey, the LOC gate, or the final repository/readiness reviews.

## Platform and provider gaps

| Surface                   | Pause evidence                                                                                   | Release gap                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| macOS                     | Current development host; focused host and E2EE suites plus injected failure tests.              | No complete local production restart/restore journey or power-loss test.                                   |
| Docker Linux/OpenSSH      | One-host `MaxSessions=1` authority journeys exercise reconnect, contention, rejection, relaunch. | Does not prove a native packaged Linux client, glibc 2.31 floor, two hosts, or an unreliable real network. |
| Real Windows              | Injected `win32` storage/ACL/rename semantics only.                                              | No Windows filesystem flush, packaged preload, ConPTY, named-pipe, native SSH, or app-restart run.         |
| Native Linux/glibc floor  | Linux OpenSSH runs inside Docker.                                                                | No packaged Ubuntu 20.04/glibc 2.31 client or bundled-native-symbol verification in this pause tranche.    |
| WSL                       | Path/identity seams have deterministic tests.                                                    | No physical WSL daemon, Git Bash/cmd boundary, reconnect, or restart journey.                              |
| Paired runtime            | Proof, wire, and projection components have focused tests.                                       | No live paired-runtime reconnect or independently updated peer journey.                                    |
| Remote server             | Remote `userData` passthrough/isolation has focused tests.                                       | No live remote-server authority, restart, or mixed-version journey.                                        |
| Two independent SSH hosts | Host and namespace isolation have focused tests.                                                 | No simultaneous two-host Docker journey.                                                                   |
| Mixed versions            | In-process current/old terminal-wire test covers both directions.                                | No live SSH/paired/remote version-skew journey or mobile/E2EE wire proof.                                  |
| Power-loss durability     | Crash-cut and syscall-failure injection covers stage, marker, active, and backup boundaries.     | No physical abrupt-power-loss run, especially on Windows filesystems.                                      |
| Performance and scale     | Bounded hot-path test measures 25,000 operations with topology-write and heap/queue assertions.  | No packaged cross-platform interaction, startup, long-session, or production-scale baseline.               |
| Folder/floating/drive/UNC | Pure locator and folder/workspace tests cover representative path shapes.                        | No complete live floating, drive-letter, or UNC workspace journey.                                         |

## Remaining work in dependency order

1. **Identity reset and re-enrollment**
   - Persist the bounded reset record before mutation.
   - Freeze new pairing and authority admission.
   - Retire the old proof-derived principal on every known final host.
   - Wait for every relay revoke outbox acknowledgement.
   - Close transports, then remove local credentials.
   - Publish the exact staged successor, invalidate captured proof material,
     verify through the strict loader, enter re-enrollment, and clear the
     transaction.
   - Retry the whole immutable host intent rather than persisting per-target
     receipts.

2. **Reachability and deletion audit**
   - Trace every new production module from a real entrypoint.
   - Start with the test-only SSH fixtures and duplicate E2EE key-material and
     authority-namespace equality functions recorded in the delivery ledger;
     repeat the import scan on the resumed tree before moving or deleting them.
   - Delete unreachable construction modules, test fixtures in production,
     duplicate exact-operation clients, and transport-specific state machines.
   - Prove that app cursors, settlement/receipt ledgers, host-current adoption,
     quarantine, and timing verdicts are unreachable after authoritative
     admission.

3. **Consolidation to the four-role design and LOC reduction**
   - One final-host service.
   - Thin exact local/daemon/SSH/WSL/relay/paired adapters.
   - One app projection/controller.
   - One bounded legacy importer that disappears as a writer after cutover.
   - Drive the rebased production diff to net non-positive.

4. **All runtime, platform, wire, and performance journeys**
   - Prove all 13 journeys in the delivery ledger.
   - Use Docker OpenSSH with `MaxSessions=1` and two independent SSH hosts.
   - Cover daemon, WSL, paired runtime, remote server, folder/floating/UNC,
     both mixed-version directions, reset crash recovery, and performance.

5. **Rebase and final categorized census**
   - Rebase onto current `origin/main` without losing the design invariants.
   - Re-run the tracked/untracked production, test, docs, CI/config, and other
     LOC census against the actual PR base.
   - Reach net-nonpositive production LOC or provide the required file-by-file
     retained-module and superseded-path justification.

6. **Independent release review**
   - Run independent repository and release-readiness reviews on the rebased,
     fully validated tree.
   - Resolve every P0-P2 or record an explicit owner-approved release decision
     where the governing checklist permits one.

7. **Commit, push, and comprehensive PR**
   - Only after G0-G7, all 13 journeys, LOC, static, performance, compatibility,
     and review gates pass, create the commit, push, and one detailed PR.

## Risks that must remain explicit

- Replacement and legacy systems coexist during construction; this is not an
  acceptable final architecture.
- A green focused suite is construction evidence, not remote, platform, wire,
  or power-loss proof.
- Remote clients and hosts update independently. New stream semantics require
  a separately negotiated capability; unknown opcodes may otherwise disappear.
- A host-wide SSH credential authenticates transport only. It cannot identify
  an app/device consumer or key a cursor.
- Missing transport, timeout, disconnect, failed inspection, and inventory
  absence remain unknown. None may authorize cleanup, exit, takeover, or
  replacement.
- Any identity stage, active-file replacement, migration rename, or reset phase
  that returns success must survive the documented crash boundary.

## First safe resume commands

Run these from the worktree before editing:

```bash
orca status --json
orca skills get orchestration
orca orchestration run-use --id run_2bf3603a101a --json
orca orchestration check --json
git status --short --branch --untracked-files=all
git stash list
git rev-list --left-right --count HEAD...origin/main
```

Process and acknowledge any returned delivery before dispatching more work.
Release every settled worker before acknowledging its `worker_done`. Never
reuse an implementation worker as its own independent auditor.

## Validation record required at pause

The full command manifest, UTC windows, durations, counts, and cleanup scan are
in `/tmp/react185-final-combined-validation-closure.md`. That closure freshly
reran the broad authority tree and reconciled, rather than redundantly reran,
the prior fresh receipts below. Each row preserves its exact command and
outcome.

| Scope                 | Exact command or artifact                                                                                                                                                                                                                                                                                                                                                                                                           | Outcome                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host focused          | `pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/pty.test.ts --reporter=dot`                                                                                                                                                                                                                                                                                                                                     | Exit 0; 466 passed. The adjacent 168 and exact-close 7 are recorded in `/tmp/react185-host-authority-closure-acceptance.md`; P0/P1/P2=0.                                |
| E2EE storage          | `pnpm exec vitest run --config config/vitest.config.ts src/main/runtime/e2ee-keypair.test.ts src/main/runtime/mobile-pairing-userdata-path.test.ts src/main/runtime/device-registry.test.ts src/main/runtime/relay/relay-revoke-outbox.test.ts src/main/durable-file-write.test.ts src/main/durable-file-write-syscall-proof.test.ts src/shared/secure-file.test.ts src/shared/secure-file-coarse-ctime.test.ts --reporter=verbose` | Exit 0; 8 files/108 tests. Remote-userData, lifecycle regression, and injected-Windows commands are recorded in `/tmp/react185-e2ee-storage-acceptance.md`; P0/P1/P2=0. |
| Broad authority tree  | `pnpm exec vitest run --config config/vitest.config.ts --testTimeout=120000 src/main/session-authority src/main/daemon src/main/ssh src/relay src/shared --reporter=dot`                                                                                                                                                                                                                                                            | Exit 0; 829 files/8,831 tests passed, 7/31 skipped, 57.310 s.                                                                                                           |
| Reliability manifest  | `pnpm run check:reliability-gates`                                                                                                                                                                                                                                                                                                                                                                                                  | Exit 0; 70 gates.                                                                                                                                                       |
| Reliability contracts | `pnpm exec vitest run --config config/vitest.config.ts config/scripts/check-reliability-gates.test.mjs config/scripts/pr-e2e-gate-contract.test.mjs --reporter=dot`                                                                                                                                                                                                                                                                 | Exit 0; 2 files/32 tests.                                                                                                                                               |
| Wire skew             | `ORCA_CROSS_VERSION_BASELINE_REF=v1.4.174 pnpm exec vitest run --config config/vitest.config.ts tests/e2e/cross-version-wire/cross-version-terminal-wire.unit.test.ts --reporter=dot`                                                                                                                                                                                                                                               | Exit 0; 4/4.                                                                                                                                                            |
| Docker SSH            | `pnpm run test:e2e:ssh-docker-terminal-authority -- --repeat-each=3`                                                                                                                                                                                                                                                                                                                                                                | Exit 0; 12/12 across four `MaxSessions=1` journeys repeated three times.                                                                                                |
| Electron build        | `pnpm run build:electron-vite`                                                                                                                                                                                                                                                                                                                                                                                                      | Exit 0; emitted preload inspection also clean.                                                                                                                          |
| Static gates          | `pnpm run typecheck:node`; standard/native/type-aware `oxlint` over the recorded 783-file manifest; `oxfmt --check` over that manifest; `pnpm run check:max-lines-ratchet`; `git diff --check`                                                                                                                                                                                                                                      | Every command exited 0; 352 grandfathered max-lines suppressions and no new bypass.                                                                                     |
| Documentation         | Fresh format, relative-link, tracked/untracked whitespace, placeholder, categorized-census, and independent audit checks                                                                                                                                                                                                                                                                                                            | Exit 0; 3 documents/1,361 lines; four P2s corrected; final P0/P1/P2=0 in `/tmp/react185-terminal-authority-docs-closure.md`.                                            |

The release-only Windows, WSL, native-glibc, paired/live-remote, two-host,
power-loss, folder/floating/UNC, and production-scale gaps remain listed above.
No omitted command is inferred from a narrower pass.
