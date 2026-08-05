import type { CodexSessionBackfillOptions } from './codex-session-backfill-types'

type MigrationRun = (
  options: CodexSessionBackfillOptions,
  systemCodexHomePathOverride?: string
) => Promise<unknown>

export type CodexSessionMigrationScheduler = {
  scheduleInitialRun(): void
  scheduleRun(): void
  requestRun(): void
}

export function createCodexSessionMigrationScheduler(args: {
  isEligible: () => boolean
  isQuitting: () => boolean
  resolveSystemCodexHomePathOverride: () => string | undefined
  prepareScheduledRun?: () => void
  startBackfill: MigrationRun
  startIndexHeal: MigrationRun
  initialDelayMs?: number
}): CodexSessionMigrationScheduler {
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null
  let scheduledRunGeneration = 0
  let pendingScheduledRunGeneration: number | null = null
  let migrationTask: Promise<void> | null = null
  let activeRunStopObserved = false
  let rerunRequested = false

  const requestRun = (rerunIfActive = false, requestedGeneration?: number): void => {
    if (requestedGeneration !== undefined) {
      pendingScheduledRunGeneration = Math.max(
        requestedGeneration,
        pendingScheduledRunGeneration ?? requestedGeneration
      )
    }
    if (args.isQuitting() || !args.isEligible()) {
      return
    }
    if (migrationTask) {
      // Why: delayed launches and resumed account transitions must survive an older active pass.
      rerunRequested ||= rerunIfActive || activeRunStopObserved
      return
    }
    if (pendingScheduledRunGeneration !== null) {
      pendingScheduledRunGeneration = null
      // Why: an older active pass can rewrite the marker after launch invalidates it.
      args.prepareScheduledRun?.()
    }
    activeRunStopObserved = false
    rerunRequested = false
    const shouldStop = (): boolean => {
      const stopped = args.isQuitting() || !args.isEligible()
      activeRunStopObserved ||= stopped
      return stopped
    }
    const systemCodexHomePathOverride = args.resolveSystemCodexHomePathOverride()
    let stoppedBackfill = false
    const task = args
      .startBackfill({ shouldStop }, systemCodexHomePathOverride)
      .then((result) => {
        stoppedBackfill = isStoppedMigrationResult(result)
        if (stoppedBackfill || shouldStop()) {
          return
        }
        return args.startIndexHeal({ shouldStop }, systemCodexHomePathOverride)
      })
      .catch((error: unknown) => {
        console.warn('[codex-session-migration] Background session migration failed:', error)
      })
      .then(() => undefined)
    migrationTask = task
    void task.finally(() => {
      if (migrationTask === task) {
        migrationTask = null
        const shouldRerun = rerunRequested || stoppedBackfill
        rerunRequested = false
        activeRunStopObserved = false
        if (shouldRerun) {
          requestRun()
        }
      }
    })
  }

  const armScheduledRun = (generation?: number): void => {
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null
      // Why: a launch can invalidate the marker while a long index-heal pass is active.
      requestRun(true, generation)
    }, args.initialDelayMs ?? 15_000)
  }

  return {
    scheduleInitialRun(): void {
      if (!scheduledTimer) {
        armScheduledRun()
      }
    },
    scheduleRun(): void {
      // Why: delay from the latest launch so Codex has time to create its rollout.
      if (scheduledTimer) {
        clearTimeout(scheduledTimer)
      }
      scheduledRunGeneration += 1
      armScheduledRun(scheduledRunGeneration)
    },
    requestRun: () => requestRun()
  }
}

function isStoppedMigrationResult(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'stopped' in result && result.stopped)
}
