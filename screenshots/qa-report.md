# CLAUDE structured lane QA — PR 13584 @ b44714fe56

**Overall verdict: NO-GO**

Date: 2026-08-12 (America/Los_Angeles)  
Branch: `brennanb2025/claude-structured-mobile`  
SHA: `b44714fe56` (`fix(i18n): catalog Claude session controls`)  
Worktree: `/Users/brennanbenson/orca/workspaces/orca/claude-structured`  
Claude Code: **2.1.228**  
Tooling: tip Electron via CDP (`playwright-cli` attach), clean isolated profile `/tmp/oqa13584`, short path (daemon OK)

## Environment

| Field | Value |
|-------|--------|
| Electron CDP | `127.0.0.1:9334`, renderer `127.0.0.1:5174` |
| Profile | `/tmp/oqa13584` (clean; daemon socket OK) |
| Identity | `Orca: brennanb2025/claude-structured-mobile` @ this worktree |
| Auth | Real user `~/.claude` + openclaw gateway (`/health` 200, `/v1/models` 200) |
| Metro | **Verified** from `claude-structured/mobile` on `:8081` (cwd confirmed) |
| iOS sim | iPhone 17 Pro `50FD514C-96F6-446E-AC90-D07A24CAB3A0` (booted); helper `:3100` attached |

## GO/NO-GO table

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Opt-in native Claude Chat create → converse, stream, cancel, model selection | **PARTIAL** | **PASS** create + stream (markers `STREAMOK_QA1`, `NATIVE_MARKER_R1`, `PINGOK`). **FAIL/partial** cancel (wrong control grabbed mid-turn → handoff path). **FAIL** model setOption (picker did not open cleanly; chip stayed Opus). Post-turn **Send stuck disabled** while tab shows Done. |
| 2 | Two full desktop round trips: Open agent TUI → real Claude TUI (same session id) → Return to chat | **FAIL** | Every Open agent TUI / Retry ends with recoverable banner: *Couldn't open the agent terminal — chat still owns this session* / Details: *The resumed terminal did not expose one exact Claude child process.* Daemon log: TUI PTY created then killed in ~150ms. |
| 3 | Busy path: Switch after this turn queues, cancellable, auto-fires, completes | **FAIL / blocked** | Could not reach TUI ownership; busy-path completion not exercised. Accidental mid-stream handoff only produced recoverable native owner. |
| 4 | Provoked transfer failure → ONE recoverable owner + Retry (revalidates; does not suspend live native turn) | **PASS (with notes)** | Single alert owner, single Retry. Retry re-attempts spawn + fails closed; lease remains `runtimeKind: native`, `claimStatus: live`. Native not transferred away. Sticky recovery banner keeps composer Send disabled after Done. |
| 5 | Mobile: Metro from THIS worktree, pair sim, banner while TUI owns, Return → native idle, no sticky recovery | **PARTIAL / blocked** | Metro cwd = `claude-structured/mobile` **PASS**. Sim + helper attached **PASS**. Mobile already on another host session (Codex Chat / SANITY markers) — **not re-paired to this tip Electron**. TUI-owns banner + Return blocked by desktop TUI handoff failure. |
| 6 | Account pinning: session pinned auth survives toggle after switching selected account | **NOT RUN** | Blocked: no successful TUI toggle; no multi-account exercise in clean profile. |

## Root cause of TUI handoff failure (reproduced outside Orca)

Bare Claude CLI resume of a **structured native** session exits immediately under Claude **2.1.228**:

```text
$ claude --setting-sources user,project,local --resume <provider-session-id>
Error: No deferred tool marker found in the resumed session. ... Provide a prompt to continue the conversation.
```

Process dies in ~2s. Orca handoff launches bare `--resume` (see `claude-tui-resume-launch.ts`), identity proof finds zero Claude child under the shell root → handoff rolls back to native with ONE recoverable owner.

Resume **with a prompt** stays alive:

```text
$ claude --setting-sources user,project,local --resume <id> "say hi"   # stays alive
```

This is a **product/CLI compatibility blocker** for native→TUI at this SHA + Claude 2.1.228, not a QA harness fluke. Prior Aug-11 live validation used Claude 2.1.227 and succeeded.

## What worked

- Clean tip Electron CDP identity for this worktree/branch.
- Opt-in **Claude Chat · Chat session** create (no terminal).
- Live gateway auth: multi-turn assistant text (`STREAMOK_QA1`, `NATIVE_MARKER_R1`, `PINGOK`).
- Handoff failure UX: single recoverable owner + Retry; native retains lease (revalidation does not suspend native ownership).
- Metro proven from **this** worktree (not codex-structured).

## Residual product issues observed

1. **Blocker:** Claude TUI resume after structured native fails on 2.1.228 bare `--resume` (deferred tool marker). Handoff cannot prove child process.
2. After completed turns, **Send remains disabled** while status shows Done (composer stuck; may be coupled to sticky recovery banner).
3. Streaming journal still chunks tokens oddly in AX (`N` / `AT` / `IVE_MAR` …) while final collapsed text is correct.
4. Sticky recovery banner after failed transfer blocks composer until resolved; Retry does not clear it when retry also fails.

## Screenshots

`/tmp/orca-claude-toggle-qa-13584/screenshots/`

| File | Meaning |
|------|---------|
| `01-native-idle.png` | Native Claude Chat + recovery banner |
| `02-after-native-marker.png` | Streamed native marker history |
| `03-after-open-tui.png` | After Open agent TUI attempt |
| `04-transfer-fail-banner.png` / `04-transfer-fail-recoverable.png` | ONE recoverable owner + Retry |
| `05-mobile-paired.png` | Sim session (paired to other host; Metro from this worktree) |
| `labeled/*` | Labeled copies for PR |

## Sessions exercised

- `desktop_msptgiha44ace4d2` (first profile run; STREAMOK)
- `desktop_msptpr2395aa71b9` (NATIVE_MARKER_R1; provider `8f1ef9c7-…`)
- `desktop_msptwp8806c13d5b` (PINGOK; provider `6c9eb149-…`)

Final lease sample (failed handoff, native retained): `runtimeKind: native`, `claimStatus: live`, fence advanced on failed attempts.

## Verdict rationale

Create + stream path is live and useful, and transfer failure recovery is correctly single-owner / native-preserving. **Full matrix cannot GO** until native→real Claude TUI resume works end-to-end on Claude 2.1.228 (and reverse Return, busy Switch-after-this-turn, mobile TUI banner, account-pin toggle are re-proven). Recommend fix handoff resume args / deferred-tool resume policy, then re-run legs 2–6.
