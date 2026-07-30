import type { ElectronApplication } from '@stablyai/playwright-test'
import {
  aggregateMainThreadDiagnosticReports,
  parseMainThreadDiagnosticLine,
  waitForMainThreadDiagnosticDrain
} from '../../tools/benchmarks/main-thread-diagnostic-report.mjs'

export type MainThreadDiagnosticInterval = {
  activityElapsedMs: number
  captureElapsedMs: number
  reportCount: number
  diagnosticWindowDurationMs: number
  spawnCount: number
  rpcCount: number
  spawns: Record<string, { count: number; blockMsTotal: number; blockMsMax: number }>
  rpcs: Record<string, { count: number }>
}

export async function captureMainThreadDiagnosticInterval<T>(
  electronApp: ElectronApplication,
  activity: () => Promise<T>
): Promise<{ activityResult: T; diagnostics: MainThreadDiagnosticInterval }> {
  const child = electronApp.process()
  const reports: Record<string, unknown>[] = []
  let buffer = ''
  const onStderr = (chunk: Buffer): void => {
    buffer += chunk.toString()
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
      const report = parseMainThreadDiagnosticLine(line)
      if (report && !report.marker) {
        reports.push(report)
      }
    }
  }
  child.stderr?.on('data', onStderr)
  try {
    const measuredReportStartIndex = await waitForMainThreadDiagnosticDrain(reports, {
      isProcessRunning: () => child.exitCode === null
    })
    const startedAt = performance.now()
    const activityResult = await activity()
    const activityElapsedMs = performance.now() - startedAt
    await waitForMainThreadDiagnosticDrain(reports, {
      isProcessRunning: () => child.exitCode === null
    })
    const captureElapsedMs = performance.now() - startedAt
    const totals = aggregateMainThreadDiagnosticReports(reports.slice(measuredReportStartIndex))
    return {
      activityResult,
      diagnostics: {
        activityElapsedMs,
        captureElapsedMs,
        reportCount: reports.length - measuredReportStartIndex,
        diagnosticWindowDurationMs: totals.diagnosticWindowDurationMs,
        spawnCount: totals.spawnCount,
        rpcCount: totals.rpcCount,
        spawns: totals.perCommand,
        rpcs: totals.perRpcMethod
      }
    }
  } finally {
    child.stderr?.off('data', onStderr)
  }
}
