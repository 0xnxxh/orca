import { getCodexSessionBackfillDate } from './codex-session-backfill-date'
import type {
  CodexSessionBackfillDate,
  CodexSessionBackfillOptions
} from './codex-session-backfill-types'

type MigrationRun = (
  options: CodexSessionBackfillOptions,
  systemCodexHomePathOverride?: string
) => Promise<unknown>

export type CodexSessionMigrationScheduler = {
  scheduleInitialRun(): void
  scheduleRun(fullScanRequired?: boolean): void
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
  const scheduledScanDates = new Map<string, CodexSessionBackfillDate>()
  const pendingScanDates = new Map<string, CodexSessionBackfillDate>()
  let scheduledFullScan = false
  let pendingFullScan = false
  let migrationTask: Promise<void> | null = null
  let activeRunStopObserved = false
  let rerunRequested = false

  const requestRun = (
    rerunIfActive = false,
    requestedGeneration?: number,
    requestedScanDates: readonly CodexSessionBackfillDate[] = [],
    requestedFullScan = false
  ): void => {
    if (requestedGeneration !== undefined) {
      pendingScheduledRunGeneration = Math.max(
        requestedGeneration,
        pendingScheduledRunGeneration ?? requestedGeneration
      )
      for (const scanDate of requestedScanDates) {
        pendingScanDates.set(scanDate.join('-'), scanDate)
      }
      pendingFullScan ||= requestedFullScan
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
    const scanDates =
      !pendingFullScan && pendingScanDates.size > 0 ? [...pendingScanDates.values()] : undefined
    pendingScanDates.clear()
    pendingFullScan = false
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
      .startBackfill({ shouldStop, scanDates }, systemCodexHomePathOverride)
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
      if (generation !== undefined) {
        const currentDate = getCodexSessionBackfillDate()
        scheduledScanDates.set(currentDate.join('-'), currentDate)
      }
      const scanDates = [...scheduledScanDates.values()]
      scheduledScanDates.clear()
      const fullScanRequired = scheduledFullScan
      scheduledFullScan = false
      // Why: a launch can invalidate the marker while a long index-heal pass is active.
      requestRun(true, generation, scanDates, fullScanRequired)
    }, args.initialDelayMs ?? 15_000)
  }

  return {
    scheduleInitialRun(): void {
      if (!scheduledTimer) {
        armScheduledRun()
      }
    },
    scheduleRun(fullScanRequired = false): void {
      // Why: delay from the latest launch so Codex has time to create its rollout.
      if (scheduledTimer) {
        clearTimeout(scheduledTimer)
      }
      scheduledRunGeneration += 1
      scheduledFullScan ||= fullScanRequired
      const launchDate = getCodexSessionBackfillDate()
      scheduledScanDates.set(launchDate.join('-'), launchDate)
      armScheduledRun(scheduledRunGeneration)
    },
    requestRun: () => requestRun()
  }
}

function isStoppedMigrationResult(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && 'stopped' in result && result.stopped)
}
