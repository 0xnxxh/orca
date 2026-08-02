# LLM Counsel Report — P1-D-hosted-review-inflight @ 5f908a17effb

- **Run:** 20260801-183920
- **Base:** `8fc892dd0238` .. HEAD (`5f908a17effb`)
- **Seats:** grok | codex gpt-5.6-sol high | claude opus high | claude fable high
- **Date:** 2026-08-02T02:07:27Z
- **Orchestration run:** `run_df9e74b354f5`
- **Scope:** 2 commits (+ non-behavioral uncommitted constant hoist/comments noted mid-review by opus)
  - `0a1ba0f987` — detachable hosted-review lookup deadline + backoff split
  - `5f908a17ef` — 30s `git remote get-url` timeout on local/WSL GitHub path
- **Focus:** performance + functionality regressions first

## Executive verdict

**Do not ship as-is if the branch claim is "wedged host recovers in-session without silent wrong PR state."** All four seats agree the 120s detachable deadline correctly *unpins* the UI, and that the cache's token/generation plumbing is largely sound. They also agree the design introduces **unbounded detached lookups** under a true hang, and at least two independent **late-answer ordering races** that can pin a stale `null` (no review) over a real open review for up to the 15-minute no-review TTL.

**Stronger claim-falsification (opus, high peer trust):** the first `git remote get-url` on the real hosted-review path is GitLab's **unbounded** probe (`FORGE_PROVIDERS[0]`), and settle-only in-flight maps below the deadline mean post-timeout retries can re-join a permanently dead promise — so the outer deadline unpins the card but does **not** restore lookup progress after a dead mount. The 30s bound added in this branch is on the *GitHub* identity path, which is often not the first call.

**Ship-blocker priority:** (1) late-adopt store predicate, (2) timeout→cached-null classification, (3) bound detached zombies / permanent lower-layer coalesce, (4) apply get-url timeout to all forge probes (not only GitHub).

Peer ratings were **blind** (labels A–D). After unblinding, overall trust rank was roughly **claude-opus ≈ claude-fable > grok > codex** (codex most conservative / fewest FPs).

## Consensus findings

Deduped where ≥2 seats agree, or one seat with strong evidence the coordinator re-verified in-tree.

### C1 — High — Late timed-out straggler can store `null` over last-known open review

| | |
|--|--|
| **Seats** | grok (High), codex (Medium reverse-order variant), fable (related Medium on non-timedOut eviction path) |
| **Files** | `src/main/source-control/hosted-review-branch-cache.ts` ~332–336 (`storeEntry` guard), ~257–260 (`answeredSince`) |
| **Impact** | Card / list shows "no PR" for up to **15 min** (inactive) or **60s** (active) while a replacement lookup may still be running; also `clearFailures` undoes deadline backoff. |
| **Evidence (coordinator verified)** | Store guard is `!(timedOut && answeredSince)`. `answeredSince` requires `fetchedAt >= startedAt`. A pre-refresh open entry has `fetchedAt < startedAt`, so a late timed-out `null` is treated as adoptable and overwrites the open review. Tests cover straggler vs *already-stored newer* answer, not vs *pre-refresh still-cached* open review or vs *in-flight replacement*. |
| **Smallest fix** | On `timedOut`, only store if cache empty **and** no other inflight owns the key; never overwrite an entry whose `fetchedAt < startedAt` with a late result; do not `clearFailures` unless the store is kept. Prefer ownership: `inflight.get(key)?.token === token` (or no inflight + empty entry). |

### C2 — High — Unbounded detached lookup accumulation under true hang

| | |
|--|--|
| **Seats** | grok High, codex High, opus Medium (measured 31 leaked / 8h / branch), fable Low (same mechanism, lower severity) |
| **Files** | `hosted-review-branch-cache.ts` `startLookup` / `expire`; `hosted-review-refresh-pacing.ts` `MAX_INFLIGHT_LOOKUPS` |
| **Impact** | Pre-branch steady state on hang: **1** pinned promise. Post-branch: each deadline+backoff cycle starts another never-settling lookup; zombies are invisible to `MAX_INFLIGHT_LOOKUPS` (map only tracks current owner). Memory/handle/quota growth over long sessions × many branches. |
| **Evidence** | `expire()` releases callers + deletes inflight record; detached IIFE still `await lookup()` with no cancel; backoff eventually allows `startLookup` again. Opus harness under fake timers: 31 starts / 8h one branch. |
| **Smallest fix** | Track detached-or-live provider work per key (and optionally global); refuse a new start while a prior attempt for the key is still unsettled; or abort via AbortSignal once lower layers support it. Cap detached count explicitly. |

### C3 — High — Branch recovery claim incomplete on real hosted-review path (GitLab-first + permanent coalesce)

| | |
|--|--|
| **Seats** | claude-opus (unique depth; peer-rated top regression catch); echoed in peer notes by all raters |
| **Files** | `src/main/source-control/forge-provider.ts` `FORGE_PROVIDERS` order; `src/main/gitlab/gitlab-project-ref-resolution.ts:92` (no timeout); `src/main/gitlab/project-ref-inflight.ts` settle-only cleanup; same pattern in known-hosts / config-signature / other forges |
| **Impact** | Dead mount / stalled git: first probe is unbounded GitLab `remote get-url`. Deadline unpins UI, but retries re-join the same never-settling promise → **no in-session lookup recovery** despite the P1-D docblock claim. |
| **Evidence (coordinator verified)** | `FORGE_PROVIDERS[0] === gitLabForgeProvider`; GitLab local get-url has no `timeout`; `runProjectRefProbeOnce` only deletes map entry in `finally` after settle. Hosted-review injects real stack, not the test's fresh `stuckLookup()` each call. |
| **Note** | Largely **pre-existing infrastructure**, not introduced by this diff — but it **falsifies the branch's stated recovery guarantee** for the production call graph. |
| **Smallest fix** | Pass `timeout: 30_000` (or shared constant) to **every** forge `remote get-url`; make lower-layer in-flight maps deadline-aware (drop/replace hung probes) or never coalesce across outer deadline generations. |

### C4 — High/Medium — New 30s timeout swallowed into definitive cached "no review"

| | |
|--|--|
| **Seats** | grok Medium, opus High, fable notes opposite at identity layer only |
| **Files** | `github-repository-identity.ts` catch → `return null`; `hosted-review.ts` `if (!provider) return null` → cache stores success null |
| **Impact** | Transient mount/WSL blip becomes a **15-minute** (list) / **60s** (active) "no PR" answer; create-PR eligibility may treat as `not_found` rather than `unavailable` (duplicate-PR risk). Regression shape: hang → false negative in 30s. |
| **Evidence (coordinator verified)** | `isStableMissingGitRemoteError` only matches `/no such remote/i`; timeout is `git timed out.` → non-stable path returns uncached null from identity, then hosted-review layer treats missing provider as successful null review. |
| **Smallest fix** | Rethrow/classify timeouts as transient at identity layer **or** map provider resolution failures to thrown/`unavailable` in hosted-review so cache does not store a definitive miss. |

### C5 — Medium — Cap eviction breaks straggler yield / double-count guards

| | |
|--|--|
| **Seats** | fable Medium×2 (strongest), codex Medium, grok Medium |
| **Files** | `trackInflight` drop-without-expire; store/catch paths gated only on `timedOut` |
| **Impact** | Under >500 concurrent inflight (pathological but the regime the cap exists for): older non-timedOut straggler can overwrite a newer store; late reject can `noteFailure` a healthy successor. |
| **Smallest fix** | Ownership-based store/failure guards (same as C1), not `timedOut`-only. |

### C6 — Medium — Reverse-order dual-timeout completion discards newer answer

| | |
|--|--|
| **Seats** | codex (unique clear statement); grok related |
| **Files** | `answeredSince` uses store time, not start order |
| **Impact** | Older timed-out attempt stores first → newer attempt's later answer dropped → stale null/metadata for up to TTL. |
| **Smallest fix** | Track attempt generation/start monotonic id; only adopt if attempt is the latest started (or still owns the key). |

## High-signal unique findings

| Finding | Seat | Sev | Coordinator take |
|---------|------|-----|------------------|
| Unbounded `fs.stat` in `readLocalGitConfigSignature` **before** bounded get-url on native local dead mounts | opus | High | **Verified path exists** (`github-repository-identity.ts` awaits signature before resolve). Pre-existing, but kills the exact "dead network mount" story in the commit comment. Elevate if P1-D scope includes native dead mounts. |
| Post-deadline straggler **success** resets escalation (`clearFailures`) → measured ~36 calls/2h vs ~8 at max backoff | opus | Medium | **Logic verified**; harness not re-run. Real quota regression on chronically slow hosts. |
| 120s deadline < sum of chained bounded steps on cold multi-forge path | opus / fable | Medium/Low | Plausible; may create new timeout errors on slow-but-alive SSH. Worth measuring, not a ship-blocker alone. |
| WSL kill may leave distro-side git | opus Low | Contested with fable's runner reading — treat as residual hygiene. |
| Sleep/wake mass `noteFailure` | fable Low | Intentional wall-clock design side effect; document / consider expire-without-escalate. |

## Performance surface

**Checked by seats:** process-wide hosted-review funnel, inflight maps, backoff, timers (`unref`), renderer poll cadence references, local/WSL/SSH get-url bounds, forge probe chain.

**Agreed:**

- Hot path cost of `expireOverdueInflight` is O(|inflight|) ≤ 500 — fine.
- Detach-on-deadline is an intentional trade: UI unblocks, but **duplicate/zombie work** is the new cost center (C2, C6).
- `clearFailures` on late slow success prevents escalation from ever reaching the 15m cap on chronically slow hosts (opus F5) — quota regression vs intent.
- GitHub local/WSL get-url 30s bound is a real hang break **for that call site**; incomplete for the full hosted-review stack (C3).

**Residual gaps:** no live NFS/SMB/WSL wedge repro in this counsel run; forge HTTP timeouts not exhaustively audited per provider.

## Functionality / regression surface

**Agreed works:**

- Tokenized inflight release (straggler cannot delete successor's map entry).
- Scope generation blocks store after in-Orca review invalidation.
- Wall-clock sweep for sleep-suspended timers on **tracked** records.
- Stale review returned to callers on refresh timeout (when no late null store race wins).
- Backoff module split preserves key/prefix semantics.

**Agreed breaks / risks:**

- False "no review" windows (C1, C4, C6).
- In-session recovery claim overstated (C3 + permanent coalesce).
- Cap-edge ordering (C5).

**Disputed:**

- Whether late adoption of a straggler null over an older open entry is "design" vs bug — **counsel verdict: bug**. Callers were already released with the last-known open review; installing a late null while a replacement is in flight is a silent UX/correctness regression, and tests do not defend it.
- Severity of detached leak (High vs Low) — **counsel: High under multi-branch long session**, Low as absolute memory bytes; still fix before relying on deadline as hang strategy.

## Peer ratings (blind)

Phase 2 was anonymized. Mapping (coordinator-only):

| Letter | Seat |
|--------|------|
| A | claude-fable |
| B | claude-opus |
| C | grok |
| D | codex |

### Aggregate mean scores (4 raters × letter)

| Seat (letter) | evidence | regression_catch | false_positive_risk (5=trust) | actionability | overall |
|---------------|----------|------------------|-------------------------------|---------------|---------|
| claude-opus (B) | 5.00 | 5.00 | 3.75 | 4.50 | **4.56** |
| claude-fable (A) | 5.00 | 3.50 | 4.50 | 4.75 | **4.44** |
| grok (C) | 4.50 | 4.50 | 3.50 | 4.75 | **4.31** |
| codex (D) | 4.25 | 3.75 | 5.00 | 3.50 | **4.12** |

**Most trusted / lowest FP:** codex (5.0 FP trust) and claude-fable (4.5).  
**Most regression catch / depth:** claude-opus (5.0 catch) — peers flag some Highs as pre-existing/out-of-diff.  
**Most actionable PR-local fix shapes:** grok + fable.  
**Most noisy risk:** opus Highs on pre-existing stack (still load-bearing for claim validity).

## Seat scorecards

| Seat | Strengths | Blind spots | Trust weight this run |
|------|-----------|-------------|------------------------|
| **claude-opus** | Left the diff; falsified recover-in-session via forge order + coalesce; measured harnesses; timeout→null→create-PR chain | Some Highs are pre-existing; WSL orphan claim contested | **Highest for claim validity / stack depth** |
| **claude-fable** | Best systematic falsification of timed-out path; unique cap-eviction store/failure race; careful Low/Info calibration | Underweighted hang zombies; missed timeout→hosted-review null cache | **Highest for on-module correctness** |
| **grok** | Clearest late-adopt open→null scenario + fix predicate + test gaps; good hang-zombie High | Less under-stack than opus | **High for ship-blocker local fix** |
| **codex** | Tight, verified, ran tests/typecheck; reverse-order dual-timeout race | Narrower; weaker fix guidance; missed timeout swallow | **High for FP-filtered consensus** |

## Recommended next actions

Ordered smallest / highest leverage first:

1. **Fix late-adopt store predicate (C1 + C6 + C5)** in `hosted-review-branch-cache.ts` — ownership or "timedOut only if empty & no inflight"; never overwrite pre-refresh open with late null; don't `clearFailures` on discarded late results.
2. **Add regression tests** for: (a) timed-out null vs pre-refresh open entry; (b) timed-out null while replacement inflight; (c) reverse-order dual timeout; (d) cap-evicted non-timedOut straggler store/reject.
3. **Classify git timeouts as unavailable**, not successful null, through hosted-review cache (C4).
4. **Bound get-url on all forge probes** (GitLab first) + make lower-layer inflight coalesce deadline-aware (C3) — required for the P1-D recovery claim to be true.
5. **Cap detached lookups** per key / process (C2); optionally stop `clearFailures` on post-deadline straggler success (opus F5).
6. **Optional / follow-up:** timeout or skip `readLocalGitConfigSignature` on dead mounts; document sleep/wake backoff side effect; re-measure 120s vs slow SSH cold path.

Review-only boundary observed: **no production fixes applied by counsel**. Note: working tree has non-behavioral uncommitted edits (`MAX_BRANCH_MAP_ENTRIES` hoist + comments) that appeared mid-run; findings still apply.

## Artifacts

```
.llm-counsel/20260801-183920/
  COUNSEL-REPORT.md          ← this file
  scope.txt
  reviews/{grok,codex,claude-opus,claude-fable}.md
  reviews-blind/{A,B,C,D}.md
  ratings-blind/rater-{1..4}.md
  ratings/{grok,codex,claude-opus,claude-fable}.md  (unblinded copies)
  blind-map.json
  score-aggregate.json
  seat-map.json / rating-seat-map.json
```
