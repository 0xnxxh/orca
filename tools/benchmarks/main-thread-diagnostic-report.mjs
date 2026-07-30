export function parseMainThreadDiagnosticLine(line) {
  const match = /^\[main-thread\] (\{.*\})$/.exec(line)
  if (!match) {
    return null
  }
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export function aggregateMainThreadDiagnosticReports(reports) {
  const perCommand = {}
  const perRpcMethod = {}
  let spawnCount = 0
  let rpcCount = 0
  let diagnosticWindowDurationMs = 0
  let maxGapMs = 0
  let gapsOver50Ms = 0
  let gapsOver250Ms = 0
  for (const report of reports) {
    spawnCount += report.spawnCount ?? 0
    rpcCount += report.rpcCount ?? 0
    diagnosticWindowDurationMs += report.windowDurationMs ?? 5_000
    maxGapMs = Math.max(maxGapMs, report.maxGapMs ?? 0)
    gapsOver50Ms += report.gapsOver50Ms ?? 0
    gapsOver250Ms += report.gapsOver250Ms ?? 0
    for (const [command, stats] of Object.entries(report.spawns ?? {})) {
      const entry = (perCommand[command] ??= { count: 0, blockMsTotal: 0, blockMsMax: 0 })
      entry.count += stats.count
      entry.blockMsTotal = Math.round((entry.blockMsTotal + stats.blockMsTotal) * 100) / 100
      entry.blockMsMax = Math.max(entry.blockMsMax, stats.blockMsMax)
    }
    for (const [method, stats] of Object.entries(report.rpcs ?? {})) {
      const entry = (perRpcMethod[method] ??= { count: 0 })
      entry.count += stats.count
    }
  }
  return {
    spawnCount,
    rpcCount,
    diagnosticWindowDurationMs,
    maxGapMs,
    gapsOver50Ms,
    gapsOver250Ms,
    perCommand,
    perRpcMethod
  }
}

export async function waitForMainThreadDiagnosticDrain(
  reports,
  {
    timeoutMs = 10_000,
    pollMs = 25,
    isProcessRunning = () => true,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}
) {
  const reportCountBeforeDrain = reports.length
  const deadline = Date.now() + timeoutMs
  while (reports.length === reportCountBeforeDrain) {
    if (!isProcessRunning()) {
      throw new Error('App exited before the warmup diagnostic drain')
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for the warmup diagnostic drain`)
    }
    await wait(pollMs)
  }
  return reports.length
}
