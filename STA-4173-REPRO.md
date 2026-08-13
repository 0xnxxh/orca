# STA-4173 reproduction

Reproduction only. No fix is in this branch.

## 1. Test file

`/Users/brennanbenson/orca/workspaces/orca/sta-4173-repro/src/main/daemon/sta-4173-checkpoint-tail-repro.test.ts`

## 2. Command

```bash
npx vitest run --config config/vitest.config.ts sta-4173-checkpoint-tail-repro
```

## 3. Verbatim failure on current main (`ee8dd4796e`)

```
 RUN  v4.1.5 /Users/brennanbenson/orca/workspaces/orca/sta-4173-repro

 ❯ src/main/daemon/sta-4173-checkpoint-tail-repro.test.ts (2 tests | 1 failed) 592ms
     × lets a healthy session warm-reattach while another session history write is stalled 506ms
     ✓ unblocks the healthy session when the process-wide checkpoint tail is skipped 85ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/main/daemon/sta-4173-checkpoint-tail-repro.test.ts > STA-4173 process-wide checkpoint tail > lets a healthy session warm-reattach while another session history write is stalled
AssertionError: expected 'timeout' to be 'completed' // Object.is equality

Expected: "completed"
Received: "timeout"

 ❯ src/main/daemon/sta-4173-checkpoint-tail-repro.test.ts:188:22
    186|     // Desired isolation: B's warm reattach must finish while A is sti…
    187|     // Today runExclusiveCheckpoint tails onto one adapter-wide promis…
    188|     expect(bOutcome).toBe('completed')
       |                      ^
    189|     expect(bCheckpoint).toHaveBeenCalled()
    190|     await expect(bReattach).resolves.toMatchObject({

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Duration  8.78s (transform 6.65s, setup 61ms, import 7.69s, tests 592ms, environment 0ms)
```

The suite does not hang. Session B's warm reattach is raced against 400ms and loses.

## 4. Non-vacuous evidence

Setup: real `DaemonServer` + `DaemonPtyAdapter` + temp `historyPath`. Two independent sessions. Only session A's `TerminalHistorySessionWriter.checkpoint` is stalled (never-resolving gate). Session B is untouched.

Guards against the overlay `try/catch` fallback:

- `stall.entered()` is true — A's history write was actually entered, not skipped.
- A's overlay is still `'timeout'` — the stall hung, it did not throw. A throw would settle A and unblock the tail via `previous.catch(() => {})`, which is a different (vacuous) path.
- The failing assertion is that B's `spawn({ sessionId: B })` completes while A is still stalled. Today it is `'timeout'`.
- A second test in the same file replaces only `runExclusiveCheckpoint` so it starts `operation()` immediately (no `checkpointInFlight` chain). B then reattaches in ~114ms, B's writer `checkpoint` is called, and the snapshot contains `SESSION_B_MARKER`. A remains stalled. That is not the live-snapshot catch fallback.

Production mutation (reverted; not in this branch):

In `src/main/daemon/daemon-pty-adapter.ts` `runExclusiveCheckpoint`, changed

```ts
const previous = this.checkpointInFlight ?? Promise.resolve()
```

to

```ts
const previous = Promise.resolve()
```

Then:

```bash
npx vitest run --config config/vitest.config.ts sta-4173-checkpoint-tail-repro -t "lets a healthy session warm-reattach"
```

Result: **PASS** in 113ms (`1 passed | 1 skipped`). Reverting that one line restores the `'timeout'` failure. The blast radius is the adapter-wide `checkpointInFlight` tail, not session B's own history write.

## 5. Branch

`sta-4173-repro`

No production code change is committed.
