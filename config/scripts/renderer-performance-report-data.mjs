import { readFileSync } from 'node:fs'
import { collectTerminalPerfRows, readJsonReport } from './terminal-perf-report-rows.mjs'

export const BENCHMARK_GROUPS = [
  'burstSequential',
  'burstBatch',
  'cadenceSequential',
  'cadenceBatch'
]

const METRIC_READERS = {
  publications: (report) => report.agentStatusWorkload?.synchronousStorePublications,
  publicationsPerBatch: (report) => report.agentStatusWorkload?.publicationsPerBatch,
  completionMs: (report) => report.agentStatusWorkload?.durationMs,
  totalActionMs: (report) => report.agentStatusWorkload?.totalActionDurationMs,
  actionP95Ms: (report) => report.agentStatusWorkload?.actionDurationMs?.p95,
  throughput: (report) => report.agentStatusWorkload?.updatesPerSecond,
  schedulingDriftP95Ms: (report) => report.agentStatusWorkload?.schedulingDriftMs?.p95,
  rendererMeanCpu: (report) => report.summary?.renderer?.meanCpuPercent,
  rendererP95Cpu: (report) => report.summary?.renderer?.p95CpuPercent,
  longTaskCount: (report) => report.rendererTiming?.after?.longTasks?.count,
  longTaskP95Ms: (report) => report.rendererTiming?.after?.longTasks?.p95,
  maxTimerDriftMs: (report) => report.rendererTiming?.after?.timerDriftMs?.max
}

export const TERMINAL_BUDGETS = Object.freeze({
  medianMs: 75,
  worstMs: 300,
  maxTimerDriftMs: 150,
  rendererDroppedBacklogs: 0
})

const EVIDENCE_CONFIGURATION_KEYS = [
  'runCount',
  'benchmark',
  'platform',
  'arch',
  'cpuCount',
  'warmupMs',
  'sampleDurationMs',
  'sampleIntervalMs',
  'maxWorkloadOverrunMs',
  'configuredWorktrees',
  'configuredLineageDepth',
  'agentsPerWorktree',
  'worktrees',
  'seededAgentRows',
  'lineageDepth',
  'targetPaneCount',
  'listenerCount'
]

const SCENARIO_CONFIGURATION_KEYS = [
  'requestedBatches',
  'updatesPerBatch',
  'requestedUpdates',
  'workloadIntervalMs',
  'workloadPattern'
]

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing finite ${label}`)
  }
  return value
}

function optionalFiniteNumber(value, label) {
  return value == null ? null : finiteNumber(value, label)
}

function integer(value, label, minimum = 0) {
  const number = finiteNumber(value, label)
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}`)
  }
  return number
}

function stringValue(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${label}`)
  }
  return value
}

export function median(values) {
  const sorted = values.toSorted((left, right) => left - right)
  if (sorted.length === 0) {
    return null
  }
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function readBenchmarkRun(path, expectedWriteMode) {
  const report = JSON.parse(readFileSync(path, 'utf8'))
  const workload = report.agentStatusWorkload
  if (!workload || workload.writeMode !== expectedWriteMode) {
    throw new Error(`${path} is not an agent-status ${expectedWriteMode} workload`)
  }
  const metrics = Object.fromEntries(
    Object.entries(METRIC_READERS).map(([key, readMetric]) => [
      key,
      optionalFiniteNumber(readMetric(report), `${key} in ${path}`)
    ])
  )
  const options = report.options ?? {}
  const samplingWindow = report.samplingWindow ?? {}
  const scaleFixture = report.scaleFixtureState ?? {}
  const requestedBatches = integer(workload.requestedBatches, `requested batches in ${path}`, 1)
  const updatesPerBatch = integer(workload.updatesPerBatch, `updates per batch in ${path}`, 1)
  const requestedUpdates = integer(workload.requestedUpdates, `requested updates in ${path}`, 1)
  const completedBatches = integer(workload.completedBatches, `completed batches in ${path}`)
  const completedUpdates = integer(workload.completedUpdates, `completed updates in ${path}`)
  if (requestedUpdates !== requestedBatches * updatesPerBatch) {
    throw new Error(`${path} requested update counts are inconsistent`)
  }
  if (completedBatches !== requestedBatches || completedUpdates !== requestedUpdates) {
    throw new Error(`${path} did not complete every requested batch and update`)
  }
  const configuredWorktrees = integer(options.worktrees, `configured worktrees in ${path}`, 1)
  const configuredLineageDepth = integer(
    options.lineageDepth,
    `configured lineage depth in ${path}`
  )
  const agentsPerWorktree = integer(options.agentsPerWorktree, `agents per worktree in ${path}`)
  const worktrees = integer(
    report.rendererCensusAfter?.worktrees?.mountedCards,
    `mounted worktrees in ${path}`,
    1
  )
  const seededAgentRows = integer(scaleFixture.seededAgentRows, `seeded agent rows in ${path}`)
  const lineageDepth = integer(
    report.rendererCensusAfter?.lineage?.measuredMaxDepth,
    `lineage depth in ${path}`
  )
  if (
    scaleFixture.applied !== true ||
    scaleFixture.requestedLineageDepth !== configuredLineageDepth ||
    scaleFixture.appliedLineageDepth !== configuredLineageDepth ||
    scaleFixture.agentsPerWorktree !== agentsPerWorktree ||
    worktrees !== configuredWorktrees ||
    lineageDepth !== configuredLineageDepth ||
    seededAgentRows !== configuredWorktrees * agentsPerWorktree
  ) {
    throw new Error(`${path} observed fixture dimensions do not match its configuration`)
  }
  const sampleDurationMs = finiteNumber(options.sampleMs, `sample duration in ${path}`)
  if (samplingWindow.requestedDurationMs !== sampleDurationMs) {
    throw new Error(`${path} sampling window does not match its configured duration`)
  }
  if (samplingWindow.workloadSettledBeforeStop !== true) {
    throw new Error(`${path} workload did not settle before sampling stopped`)
  }
  const expectedAction = expectedWriteMode === 'batch' ? 'setAgentStatuses' : 'setAgentStatus'
  if (workload.action !== expectedAction) {
    throw new Error(`${path} did not exercise the expected direct-store action`)
  }
  const targetPaneCount = integer(workload.targetPaneCount, `target pane count in ${path}`, 1)
  const checkedTargets = integer(
    workload.verification?.checkedTargets,
    `verified target count in ${path}`
  )
  const mismatchedTargets = integer(
    workload.verification?.mismatchedTargets,
    `mismatched target count in ${path}`
  )
  if (
    targetPaneCount !== seededAgentRows ||
    checkedTargets !== targetPaneCount ||
    mismatchedTargets !== 0
  ) {
    throw new Error(`${path} final-state verification does not cover the full fixture`)
  }
  return {
    benchmark: stringValue(report.benchmark, `benchmark name in ${path}`),
    platform: stringValue(report.platform?.platform, `platform in ${path}`),
    arch: stringValue(report.platform?.arch, `architecture in ${path}`),
    cpuCount: integer(report.platform?.cpus, `CPU count in ${path}`, 1),
    warmupMs: finiteNumber(options.warmupMs, `sampling warmup in ${path}`),
    sampleDurationMs,
    sampleIntervalMs: finiteNumber(options.intervalMs, `sampling interval in ${path}`),
    maxWorkloadOverrunMs: finiteNumber(
      samplingWindow.maxWorkloadOverrunMs,
      `maximum sampling overrun in ${path}`
    ),
    configuredWorktrees,
    configuredLineageDepth,
    agentsPerWorktree,
    requestedBatches,
    updatesPerBatch,
    requestedUpdates,
    completedBatches,
    completedUpdates,
    workloadIntervalMs: finiteNumber(workload.intervalMs, `workload interval in ${path}`),
    workloadPattern: stringValue(workload.workloadPattern, `workload pattern in ${path}`),
    targetPaneCount,
    verificationPassed: workload.verification?.passed === true,
    worktrees,
    seededAgentRows,
    lineageDepth,
    listenerCount: integer(
      report.rendererCensusAfter?.storeListeners,
      `store listeners in ${path}`
    ),
    metrics
  }
}

function commonValue(runs, key, label) {
  const values = [...new Set(runs.map((run) => run[key]))]
  if (values.length !== 1) {
    throw new Error(`${label} differs across benchmark repetitions`)
  }
  return values[0]
}

export function aggregateBenchmarkRuns(paths, expectedWriteMode) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`At least one ${expectedWriteMode} benchmark path is required`)
  }
  const runs = paths.map((path) => readBenchmarkRun(path, expectedWriteMode))
  if (runs.some((run) => !run.verificationPassed)) {
    throw new Error(`A ${expectedWriteMode} benchmark failed final-state verification`)
  }
  const metricValues = Object.fromEntries(
    Object.keys(METRIC_READERS).map((key) => [
      key,
      runs.map((run) => run.metrics[key]).filter((value) => value != null)
    ])
  )
  return {
    runCount: runs.length,
    writeMode: expectedWriteMode,
    benchmark: commonValue(runs, 'benchmark', 'Benchmark name'),
    platform: commonValue(runs, 'platform', 'Platform'),
    arch: commonValue(runs, 'arch', 'Architecture'),
    cpuCount: commonValue(runs, 'cpuCount', 'CPU count'),
    warmupMs: commonValue(runs, 'warmupMs', 'Sampling warmup'),
    sampleDurationMs: commonValue(runs, 'sampleDurationMs', 'Sampling duration'),
    sampleIntervalMs: commonValue(runs, 'sampleIntervalMs', 'Sampling interval'),
    maxWorkloadOverrunMs: commonValue(runs, 'maxWorkloadOverrunMs', 'Maximum workload overrun'),
    configuredWorktrees: commonValue(runs, 'configuredWorktrees', 'Configured worktrees'),
    configuredLineageDepth: commonValue(runs, 'configuredLineageDepth', 'Configured lineage depth'),
    agentsPerWorktree: commonValue(runs, 'agentsPerWorktree', 'Agents per worktree'),
    requestedBatches: commonValue(runs, 'requestedBatches', 'Requested batches'),
    updatesPerBatch: commonValue(runs, 'updatesPerBatch', 'Updates per batch'),
    requestedUpdates: commonValue(runs, 'requestedUpdates', 'Requested updates'),
    completedBatches: commonValue(runs, 'completedBatches', 'Completed batches'),
    completedUpdates: commonValue(runs, 'completedUpdates', 'Completed updates'),
    workloadIntervalMs: commonValue(runs, 'workloadIntervalMs', 'Workload interval'),
    workloadPattern: commonValue(runs, 'workloadPattern', 'Workload pattern'),
    targetPaneCount: commonValue(runs, 'targetPaneCount', 'Target pane count'),
    worktrees: commonValue(runs, 'worktrees', 'Mounted worktrees'),
    seededAgentRows: commonValue(runs, 'seededAgentRows', 'Seeded agent rows'),
    lineageDepth: commonValue(runs, 'lineageDepth', 'Lineage depth'),
    listenerCount: commonValue(runs, 'listenerCount', 'Store listener count'),
    allVerified: true,
    metrics: Object.fromEntries(
      Object.entries(metricValues).map(([key, values]) => [key, median(values)])
    ),
    metricRunCounts: Object.fromEntries(
      Object.entries(metricValues).map(([key, values]) => [key, values.length])
    )
  }
}

function readTerminalRegression(path, paneCount) {
  const report = readJsonReport(path)
  const rows = collectTerminalPerfRows(report, 'terminal regression')
  const scenario = `opencode-scale-same-workspace-${paneCount}`
  const matchingRows = rows.filter((candidate) => candidate.scenario === scenario)
  if (matchingRows.length === 0) {
    throw new Error(`No ${scenario} annotation found in ${path}`)
  }
  const readMetric = (key, label) => {
    const values = matchingRows.map((row) => finiteNumber(row[key], `${label} in ${path}`))
    if (new Set(values).size !== 1) {
      throw new Error(`${label} differs across ${scenario} annotations in ${path}`)
    }
    return values[0]
  }
  const observedPanes = readMetric('panes', 'Terminal pane count')
  if (observedPanes !== paneCount) {
    throw new Error(`${path} terminal annotation pane count does not match ${scenario}`)
  }
  const observations = {
    medianMs: readMetric('medianMs', 'Terminal median latency'),
    worstMs: readMetric('worstMs', 'Terminal worst latency'),
    maxTimerDriftMs: readMetric('maxTimerDriftMs', 'Terminal maximum timer drift'),
    rendererDroppedBacklogs: readMetric('rendererDroppedBacklogs', 'Terminal dropped backlogs')
  }
  if (
    Object.values(observations).some((value) => value < 0) ||
    !Number.isInteger(observations.rendererDroppedBacklogs)
  ) {
    throw new Error(`${path} terminal regression contains an invalid measurement`)
  }
  const failures = Object.entries(TERMINAL_BUDGETS)
    .filter(([key, budget]) => observations[key] > budget)
    .map(([key, budget]) => `${key} ${observations[key]} exceeds ${budget}`)
  const passed = failures.length === 0
  if (!passed) {
    throw new Error(`${path} terminal regression exceeded its budget: ${failures.join(', ')}`)
  }
  return {
    paneCount,
    ...observations,
    budgets: TERMINAL_BUDGETS,
    passed
  }
}

function assertComparable(left, right, label, keys) {
  for (const key of keys) {
    if (left[key] !== right[key]) {
      throw new Error(`${label} ${key} differs across compared evidence groups`)
    }
  }
}

export function collectRendererPerformanceEvidence({ groups, terminalReportPath, terminalPanes }) {
  for (const key of BENCHMARK_GROUPS) {
    if (!groups[key]) {
      throw new Error(`Missing benchmark group: ${key}`)
    }
  }
  const burstSequential = aggregateBenchmarkRuns(groups.burstSequential, 'sequential')
  const burstBatch = aggregateBenchmarkRuns(groups.burstBatch, 'batch')
  const cadenceSequential = aggregateBenchmarkRuns(groups.cadenceSequential, 'sequential')
  const cadenceBatch = aggregateBenchmarkRuns(groups.cadenceBatch, 'batch')
  const comparisonKeys = [...EVIDENCE_CONFIGURATION_KEYS, ...SCENARIO_CONFIGURATION_KEYS]
  assertComparable(burstSequential, burstBatch, 'Burst', comparisonKeys)
  assertComparable(cadenceSequential, cadenceBatch, 'Cadence', comparisonKeys)
  for (const run of [burstBatch, cadenceSequential, cadenceBatch]) {
    assertComparable(burstSequential, run, 'Evidence', EVIDENCE_CONFIGURATION_KEYS)
  }
  return {
    burst: { sequential: burstSequential, batch: burstBatch },
    cadence: { sequential: cadenceSequential, batch: cadenceBatch },
    terminal: readTerminalRegression(terminalReportPath, terminalPanes)
  }
}
