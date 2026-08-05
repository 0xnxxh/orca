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
  startBackfill: MigrationRun
  startIndexHeal: MigrationRun
  initialDelayMs?: number
}): CodexSessionMigrationScheduler {
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null
  let migrationTask: Promise<void> | null = null
  let activeRunStopObserved = false
  let rerunRequested = false

  const requestRun = (rerunIfActive = false): void => {
    if (args.isQuitting() || !args.isEligible()) {
      return
    }
    if (migrationTask) {
      // Why: delayed launches and resumed account transitions must survive an older active pass.
      rerunRequested ||= rerunIfActive || activeRunStopObserved
      return
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

  const armScheduledRun = (): void => {
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null
      // Why: a launch can invalidate the marker while a long index-heal pass is active.
      requestRun(true)
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
      armScheduledRun()
    },
    requestRun: () => requestRun()
  }
}

function isStoppedMigrationResult(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'stopped' in result && result.stopped)
}
