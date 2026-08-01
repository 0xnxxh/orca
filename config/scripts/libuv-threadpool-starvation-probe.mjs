#!/usr/bin/env node
// Does converting a main-thread sync fs call to fs/promises actually fix a stalled-mount
// freeze, or just move the block into libuv's (default 4) threadpool threads?
//
// A FIFO with no writer stands in for a hung mount: open(2) blocks and cannot be cancelled,
// which is the same shape as an SMB stat in D-state.
//
// Usage: node config/scripts/libuv-threadpool-starvation-probe.mjs [stuckCount]
//   UV_THREADPOOL_SIZE=N to vary the pool.

import { mkdtempSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stuckCount = Number(process.argv[2] ?? 4)
const poolSize = process.env.UV_THREADPOOL_SIZE ?? '4 (default)'
const dir = mkdtempSync(join(tmpdir(), 'orca-threadpool-probe-'))

const fifos = Array.from({ length: stuckCount }, (_, i) => {
  const p = join(dir, `stuck-${i}.fifo`)
  execFileSync('mkfifo', [p])
  return p
})

// Event-loop liveness: a timer firing on schedule proves the main thread itself is free.
let maxTimerGapMs = 0
let lastTick = performance.now()
const ticker = setInterval(() => {
  const now = performance.now()
  maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick - 25)
  lastTick = now
}, 25)

// Park `stuckCount` threadpool threads on opens that never return.
for (const fifo of fifos) {
  void readFile(fifo, 'utf-8').catch(() => {})
}

// Give libuv a moment to dispatch them onto threads.
await new Promise((r) => setTimeout(r, 500))

// The question: can an UNRELATED async fs call still make progress?
const startedAt = performance.now()
let healthyOpMs = null
let healthyOpTimedOut = false
await Promise.race([
  stat(process.cwd()).then(() => {
    healthyOpMs = performance.now() - startedAt
  }),
  new Promise((r) => setTimeout(r, 3000)).then(() => {
    healthyOpTimedOut = true
  })
])

clearInterval(ticker)

console.log(
  JSON.stringify(
    {
      poolSize,
      stuckOps: stuckCount,
      eventLoopAlive: maxTimerGapMs < 250,
      maxTimerGapMs: Math.round(maxTimerGapMs),
      unrelatedAsyncFsCompleted: !healthyOpTimedOut,
      unrelatedAsyncFsMs: healthyOpMs === null ? null : Math.round(healthyOpMs),
      verdict: healthyOpTimedOut
        ? 'THREADPOOL STARVED — async conversion relocates the hang, it does not bound it'
        : 'async fs still progressing — main thread and threadpool both healthy'
    },
    null,
    2
  )
)

// Why no cleanup here: unlinking a FIFO that still has a blocked opener wedges this process
// after the measurement is already printed. The caller removes the directory instead.
console.error(`probe scratch dir (remove after): ${dir}`)
process.exit(0)
