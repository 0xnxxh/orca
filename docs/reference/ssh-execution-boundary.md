# SSH Execution Boundary

How Orca splits work between your machine and an SSH host, what survives a disconnect, and how to keep `unverifiable` distinct from `exited`. Nothing under `docs/` stated this before; agents and humans were inferring it from error strings and getting it wrong.

## The rule

**The execution host owns everything that touches execution** — tools, credentials, identity, environment, processes, and artifacts. The client owns the UI, transport, and Orca control-plane state, but no execution state.

Two consequences, both non-negotiable:

1. **No silent substitution.** An operation on a remote `repoPath` must never fall back to running on the client. A missing SSH provider is not permission to answer locally — a local run can answer for the _wrong repository_.
2. **No asserting what you cannot observe.** Loss of contact is not evidence of `exited`. Report `unverifiable`, never `exited`.

The vocabulary is fixed: **`live` / `unverifiable` / `exited`**, taken from the incumbent `UnstoppedPtyVerdict`. Do not introduce synonyms, and never collapse `unverifiable` into either neighbour. `exited` requires positive evidence of absence from the host that owns the process; a transport failure can only ever produce `unverifiable`.

Rule 1 is stated at `src/main/source-control/repo-default-branch.ts:76-78`, `src/main/repo-worktrees.ts:45-48`, `OrcaRuntimeService.probeWorktreeDrift` in `src/main/runtime/orca-runtime.ts`, and `src/renderer/src/lib/connection-context.ts:22-24`. It is enforced throughout `src/main/runtime/orca-runtime-git.ts` by the guard that throws `SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE` whenever `target.connectionId` is set and no provider is registered — grep that constant for the current call sites rather than trusting a count.

`src/main/runtime/unstopped-pty-verification.ts:12-16` is the reference implementation of rule 2: it keeps `live` / `unverifiable` / `exited` as three distinct verdicts, and treats "we could not ask" as its own answer.

## What runs where

| Concern                                                        | Executes on        | Notes                                                                |
| -------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| PTYs, agent CLIs                                               | **remote**         | children of the detached relay daemon, not of the ssh channel        |
| git (status, diff, log, fetch, push, commit, branch, worktree) | **remote**         | via `src/relay/git-handler.ts`                                       |
| filesystem, watching, search                                   | **remote**         |                                                                      |
| repo setup hooks (`--setup`)                                   | **remote**         | identical policy to local                                            |
| commit-message / PR-field AI generation                        | **remote**         | uses the remote agent CLI and its auth                               |
| `gh` / GitHub API, `glab` / GitLab                             | **client**         | a boundary violation; see Known gaps                                 |
| the `orca` CLI inside a remote terminal                        | **client runtime** | control plane only — your files and processes stay remote; see below |

## Survival: what a disconnect does _not_ do

By default, remote work survives your machine going away. The relay is a detached daemon (`nohup … </dev/null &`), its handler in `src/relay/relay.ts` ignores `SIGHUP`, the PTY is its child rather than the ssh channel's, and quitting Orca is a **detach, not a dispose** (`src/main/ssh/ssh-relay-session.ts:901-915`). Sleep additionally pushes `graceTimeSeconds: 0` to un-bound any running grace window.

Two ways remote work _can_ actually stop:

- **A bounded grace period.** The shipped default is `0` = keep alive until reset. If "keep terminals alive until reset" is unchecked, the configurable range is **60s–7d** and the form defaults to **24h**. The countdown starts when the client disconnects, after which the relay SIGKILLs every PTY. Note the asymmetry: sleep protects you, but ordinary disconnect and app quit do not. There is currently **no command that reports which setting is in effect for a target** — see Known gaps.
- **Host-acknowledged explicit user action** — End Remote Terminals, Reset Relay, removing the target, or closing the tab. When the host cannot acknowledge the request, closing a tab or removing a target may clear only client state; the remote verdict remains `unverifiable`.

Reconnect re-attaches to the same live PTYs and replays a bounded buffer (`REPLAY_BUFFER_MAX`, a 102,400-code-unit tail). Output beyond that while you were away is lost to the client even though the process was never interrupted: **the transcript is truncated; the work stays `live`.**

## Control plane

On an SSH host, `orca` is a shim (`~/.orca-relay/bin/orca`) that proxies **back to the client's runtime** over the relay socket. Your repository, processes, and files remain remote — only the control plane is on the client. This is correct for an SSH target, but it has a consequence worth stating plainly:

> When the client disconnects, every `orca …` command run on the SSH host fails with `No owning Orca client is connected to the relay`. The PTY stays `live`; its control plane does not.

Orchestration state (Runs, Tasks, Dispatches, mailboxes) is client-resident for the same reason. An agent on an SSH host should not depend on `orca` for anything it must finish while you are away. **Commit and push early** — unpushed work on a remote box is unavailable to the client until it reconnects.

## Distinguishing `unverifiable` from `exited`

Several signals currently report the first as the second. Until the fixes below land, treat every row here as `unverifiable`:

| Signal                                 | Says                        | May actually mean                        |
| -------------------------------------- | --------------------------- | ---------------------------------------- |
| `connected: false`                     | process exited              | relay dropped                            |
| `terminal_not_writable`                | terminal won't accept input | link down; bytes may already have landed |
| `worker-stop` → "process is exited"    | agent `exited`              | transport failure                        |
| `terminal close` → "PTY killed"        | PTY `exited`                | termination was not acknowledged         |
| `hasChildProcesses: false`             | idle                        | `unverifiable`, possibly busy            |
| `runtime_unavailable` → "Restart Orca" | the command failed          | it may have fully succeeded              |

**The one real discriminator:** a relay drop makes every remote PTY on that target `unverifiable` together. A host-delivered termination event for the current PTY incarnation and provider generation, while its siblings remain `live`, establishes that PTY as `exited`; a stale event or one quiet terminal without host evidence does not. Check the siblings, event identity, and the source of the signal before assigning a verdict.

**Prefer artifacts over process state, but read them precisely.** A matching expected commit from `git ls-remote --heads origin <branch>` or a PR head lookup proves that commit reached the remote. A branch or PR alone does not prove the latest work was pushed, and an absent result does not prove that nothing was ever pushed: the ref may have been deleted, the PR may be closed, or the query may have failed. A clean _local_ worktree says nothing at all about the remote one.

`orca terminal list` also has no host field and silently returns only the runtime you are pointed at. **An empty result is not evidence that nothing is running elsewhere.**

## Known gaps

Fixed (PRs open): client-git fallback in `src/main/github/client.ts` (#14945), repo-icon local filesystem probe (#14947), GHES auth cache key omitting the connection (#14948).

Outstanding, roughly by impact on reaching a wrong conclusion:

- **`restoreRequired` is relabeled `SSH_SESSION_EXPIRED`** in `SshPtyProvider.spawn` (`src/main/providers/ssh-pty-provider.ts`). A delivery-layer "cannot resume your output stream" becomes a claim the session `exited`; the lease is marked `expired`, filtered from all future reattaches, and a duplicate agent is cold-started over the same worktree while the original may still be `live`. Highest-impact open item. `abandonPtySourceRecovery` (`src/main/ssh/ssh-relay-session.ts:3006-3008`) handles the same relay answer correctly and is the model to copy.
- **No `unverifiable` verdict** in the signals table above. Necessary but not sufficient on its own — the lease is often already destroyed before any verdict is rendered.
- **`orca terminal list` has no host field**, and a runtime-scoped listing does not mark itself partial.
- **No way to observe a target's effective grace period.** At 17 hours since disconnect, "unlimited" and "24h with 7 hours left" demand opposite actions, and nothing reports which applies.
- **Nothing in any error or command output points at this document.** A reader only finds these rules by being told they exist.
- **Credentials are not provisioned on SSH hosts**: `gh` auth is never probed (`src/main/ipc/preflight.ts` is local/WSL only), git `user.name`/`user.email` produce an error message only, SSH agent forwarding happens only if your own `~/.ssh/config` sets `ForwardAgent yes`, and provider API keys are not carried at all. An agent can do all the work and fail at the push — which also makes artifact-checking inconclusive.
- **`ORCA_CLI_COMMAND` is not set on SSH hosts** (`src/main/ipc/pty.ts:1883-1893` is WSL-only) although the bundled guides tell agents to prefer it. On Linux, bare `orca` is usually `/usr/bin/orca`, the GNOME screen reader. Orca's own PTYs prepend `~/.orca-relay/bin` to `PATH`, but a process launched outside an Orca-managed PTY does not inherit that override.
- **`gh`/`glab` execute on the client** for SSH repos (`src/main/github/github-repository-identity.ts:41-52`, `src/main/gitlab/gitlab-project-ref-resolution.ts:245-256`). PRs are authored by the client's GitHub identity, the client's rate limit is spent, and the PR body is written to the client's tmpdir. Moving this to the execution host needs a new relay RPC surface — the relay has no `gh.*` method today.
- **`doResetRelay` marks every lease `expired` in a `finally`** (`src/main/ipc/ssh.ts:1393-1399`). The code carries an explicit rationale at `:1401` — reset force-kills the relay, so local handles are stale "even if the reset command failed after SIGTERM." That rationale is sound for its stated case but does not cover the case where the command never ran at all (transport failure), where the client records a termination that never happened.
- **Windows relay-install GC** treats 200 ms of pipe silence as proof the relay `exited` and deletes its directory (`src/main/ssh/ssh-relay-versioned-install.ts:355-361`). The sibling exception path already fails closed correctly.
- **Shared symlinks, `orca.yaml` shared directories, and `.worktreeinclude` are silently skipped** for SSH worktree creation (`src/main/ipc/worktree-remote.ts:1885`).

## One host, one model

An SSH host and a paired runtime (`orca environment`) imply opposite boundaries: the first is a dumb execution host driven by your client, the second is a peer that owns its own control plane. Registering the same machine both ways splits its worktrees across two identities, makes `terminal list` return different sets depending on `--environment`, and reliably confuses both humans and agents. Pick one per machine.

For work that must continue while you are offline, prefer running the **coordinator itself** on the remote host as a detached process over standing up a second Orca runtime there. A headless runtime's agent terminals are its children and become `exited` when it bounces; a detached process does not. The trade is steerability — a detached process has no stdin, so its instructions cannot be amended mid-run.
