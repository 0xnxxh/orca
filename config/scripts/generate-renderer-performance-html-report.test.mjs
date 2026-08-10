import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateRendererPerformanceHtmlReport,
  parseRendererPerformanceReportArgs
} from './generate-renderer-performance-html-report.mjs'

const tempDirs = []

function makeTempDir() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-renderer-performance-report-'))
  tempDirs.push(directory)
  return directory
}

function writeBenchmark(directory, name, options) {
  const path = join(directory, `${name}.json`)
  const worktrees = options.worktrees ?? 100
  const lineageDepth = options.lineageDepth ?? 99
  const agentsPerWorktree = options.agentsPerWorktree ?? 1
  const sampleDurationMs = options.sampleDurationMs ?? 15_000
  const sampleIntervalMs = options.sampleIntervalMs ?? 250
  const workloadIntervalMs = options.workloadIntervalMs ?? 1
  const metrics = {
    publications: 100,
    completionMs: 300,
    totalActionMs: 280,
    actionP95Ms: 40,
    throughput: 500,
    driftP95Ms: 120,
    meanCpu: 30,
    p95Cpu: 100,
    longTaskCount: 6,
    longTaskP95Ms: 90,
    maxTimerDriftMs: 140,
    ...options.metrics
  }
  writeFileSync(
    path,
    JSON.stringify({
      benchmark: 'orca-idle-cpu',
      options: {
        warmupMs: 5000,
        sampleMs: sampleDurationMs,
        intervalMs: sampleIntervalMs,
        worktrees,
        lineageDepth,
        agentsPerWorktree
      },
      platform: options.platform ?? { platform: 'darwin', arch: 'arm64', cpus: 16 },
      processInventory: [{ command: 'ssh secret.example.test --token=hunter2' }],
      samples: [{ pid: 1234, path: '/Users/private/worktree' }],
      agentStatusWorkload: {
        workloadPattern: 'ordered-round-robin-v1',
        writeMode: options.writeMode,
        action: options.writeMode === 'batch' ? 'setAgentStatuses' : 'setAgentStatus',
        requestedBatches: options.requestedBatches,
        completedBatches: options.completedBatches ?? options.requestedBatches,
        updatesPerBatch: options.updatesPerBatch,
        requestedUpdates: options.requestedBatches * options.updatesPerBatch,
        completedUpdates:
          options.completedUpdates ?? options.requestedBatches * options.updatesPerBatch,
        targetPaneCount: worktrees * agentsPerWorktree,
        intervalMs: workloadIntervalMs,
        synchronousStorePublications: metrics.publications,
        publicationsPerBatch: metrics.publications / options.requestedBatches,
        durationMs: metrics.completionMs,
        totalActionDurationMs: metrics.totalActionMs,
        updatesPerSecond: metrics.throughput,
        actionDurationMs: { p95: metrics.actionP95Ms },
        schedulingDriftMs: { p95: metrics.driftP95Ms },
        verification: {
          checkedTargets: worktrees * agentsPerWorktree,
          mismatchedTargets: 0,
          passed: options.verificationPassed ?? true
        }
      },
      summary: {
        renderer: {
          meanCpuPercent: metrics.meanCpu,
          p95CpuPercent: metrics.p95Cpu
        }
      },
      rendererTiming: {
        after: {
          longTasks: { count: metrics.longTaskCount, p95: metrics.longTaskP95Ms },
          timerDriftMs: { max: metrics.maxTimerDriftMs }
        }
      },
      rendererCensusAfter: {
        worktrees: { mountedCards: worktrees },
        lineage: { measuredMaxDepth: lineageDepth },
        storeListeners: 1618
      },
      scaleFixtureState: {
        applied: true,
        requestedLineageDepth: lineageDepth,
        appliedLineageDepth: lineageDepth,
        agentsPerWorktree,
        seededAgentRows: worktrees * agentsPerWorktree
      },
      samplingWindow: {
        requestedDurationMs: sampleDurationMs,
        maxWorkloadOverrunMs: 120_000,
        workloadSettledBeforeStop: true
      }
    })
  )
  return path
}

function writeRuns(
  directory,
  prefix,
  writeMode,
  requestedBatches,
  updatesPerBatch,
  values,
  options = {}
) {
  return values.map((metrics, index) =>
    writeBenchmark(directory, `${prefix}-${index + 1}`, {
      ...options,
      writeMode,
      requestedBatches,
      updatesPerBatch,
      metrics
    })
  )
}

function writeTerminalReport(
  directory,
  description = 'panes=20 median=8.2ms worst=27.1ms maxTimerDrift=16.9ms rendererDroppedBacklogs=0 samples=secret-pane-samples',
  name = 'terminal.json'
) {
  const path = join(directory, name)
  writeFileSync(
    path,
    JSON.stringify({
      suites: [
        {
          specs: [
            {
              tests: [
                {
                  annotations: [
                    {
                      type: 'opencode-scale-same-workspace-20',
                      description
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  )
  return path
}

function createInputs() {
  const directory = makeTempDir()
  const groups = {
    burstSequential: writeRuns(directory, 'burst-sequential', 'sequential', 1, 2000, [
      { publications: 2000, totalActionMs: 3600 },
      { publications: 2000, totalActionMs: 3400 },
      { publications: 2000, totalActionMs: 3500 }
    ]),
    burstBatch: writeRuns(directory, 'burst-batch', 'batch', 1, 2000, [
      { publications: 1, totalActionMs: 190 },
      { publications: 1, totalActionMs: 170 },
      { publications: 1, totalActionMs: 180 }
    ]),
    cadenceSequential: writeRuns(
      directory,
      'cadence-sequential',
      'sequential',
      60,
      32,
      [
        { publications: 1920, longTaskCount: 60 },
        { publications: 1920, longTaskCount: 58 },
        { publications: 1920, longTaskCount: 56 }
      ],
      { workloadIntervalMs: 33 }
    ),
    cadenceBatch: writeRuns(
      directory,
      'cadence-batch',
      'batch',
      60,
      32,
      [
        { publications: 60, longTaskCount: 0, longTaskP95Ms: null },
        { publications: 60, longTaskCount: 2, longTaskP95Ms: 59 },
        { publications: 60, longTaskCount: 3, longTaskP95Ms: 55 }
      ],
      { workloadIntervalMs: 33 }
    )
  }
  const fontPath = join(directory, 'Geist.woff2')
  writeFileSync(fontPath, 'font')
  return {
    directory,
    fontPath,
    groups,
    terminalReportPath: writeTerminalReport(directory)
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { force: true, recursive: true })
  }
})

describe('generate-renderer-performance-html-report', () => {
  it('parses repeated benchmark groups and report options', () => {
    const parsed = parseRendererPerformanceReportArgs([
      '--burst-sequential',
      'bs1.json',
      '--burst-sequential',
      'bs2.json',
      '--burst-batch',
      'bb.json',
      '--cadence-sequential',
      'cs.json',
      '--cadence-batch',
      'cb.json',
      '--terminal-report',
      'terminal.json',
      '--terminal-panes',
      '20',
      '--font',
      'font.woff2',
      '--output',
      'report.html'
    ])

    expect(parsed.groups.burstSequential).toEqual(['bs1.json', 'bs2.json'])
    expect(parsed.groups.burstBatch).toEqual(['bb.json'])
    expect(parsed.terminalPanes).toBe(20)
    expect(parsed.outputPath).toBe('report.html')
    expect(parsed.fontPath).toBe('font.woff2')
    expect(() => parseRendererPerformanceReportArgs([])).toThrow('Missing')
  })

  it('writes a self-contained sanitized report from verified median evidence', () => {
    const inputs = createInputs()
    const outputPath = join(inputs.directory, 'report.html')
    const result = generateRendererPerformanceHtmlReport({
      ...inputs,
      outputPath,
      now: new Date('2026-08-10T08:00:00.000Z')
    })
    const html = readFileSync(outputPath, 'utf8')

    expect(result.evidence.burst.sequential.metrics.totalActionMs).toBe(3500)
    expect(result.evidence.burst.batch.metrics.totalActionMs).toBe(180)
    expect(result.evidence.cadence.batch.metrics.longTaskP95Ms).toBe(57)
    expect(result.evidence.cadence.batch.metricRunCounts.longTaskP95Ms).toBe(2)
    expect(result.evidence.terminal).toMatchObject({
      paneCount: 20,
      medianMs: 8.2,
      worstMs: 27.1,
      rendererDroppedBacklogs: 0,
      passed: true
    })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('url(data:font/woff2;base64,Zm9udA==)')
    expect(html).toContain('--background:#fff')
    expect(html).toContain('--background:#0a0a0a')
    expect(html).toContain('One store publication per deferred status transaction')
    expect(html).toContain('not an end-to-end IPC publication count')
    expect(html).toContain('33 ms sustained saturation stress')
    expect(html).toContain('not a real-time production SLO')
    expect(html).toContain('bounds the status/store amplification portion')
    expect(html).toContain('reconnect repaint remains a separate follow-up')
    expect(html).toContain('8.2 ms')
    expect(html).toContain('≤ 75.0 ms')
    expect(html).toContain('≤ 300.0 ms')
    expect(html).toContain('≤ 150.0 ms')
    expect(html).toContain('2/3 runs')
    expect(html).toContain('Final state verified')
    expect(html).not.toContain('157 passed')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('secret.example.test')
    expect(html).not.toContain('/Users/private')
    expect(html).not.toContain('secret-pane-samples')
    expect(html).not.toContain('1234')
  })

  it('rejects any benchmark repetition that fails final-state verification', () => {
    const inputs = createInputs()
    const failedPath = writeBenchmark(inputs.directory, 'failed', {
      writeMode: 'batch',
      requestedBatches: 1,
      updatesPerBatch: 2000,
      verificationPassed: false
    })

    expect(() =>
      generateRendererPerformanceHtmlReport({
        ...inputs,
        groups: { ...inputs.groups, burstBatch: [failedPath] },
        outputPath: join(inputs.directory, 'report.html')
      })
    ).toThrow('failed final-state verification')
  })

  it('rejects incomplete benchmark workloads', () => {
    const inputs = createInputs()
    const incompletePath = writeBenchmark(inputs.directory, 'incomplete', {
      writeMode: 'batch',
      requestedBatches: 1,
      updatesPerBatch: 2000,
      completedUpdates: 1999
    })

    expect(() =>
      generateRendererPerformanceHtmlReport({
        ...inputs,
        groups: { ...inputs.groups, burstBatch: [incompletePath] },
        outputPath: join(inputs.directory, 'report.html')
      })
    ).toThrow('did not complete every requested batch and update')
  })

  it('rejects incomparable repetition counts, machines, sampling, and fixtures', () => {
    const inputs = createInputs()
    const metrics = [{ publications: 1 }, { publications: 1 }, { publications: 1 }]
    const cases = [
      ['runCount', inputs.groups.burstBatch.slice(0, 2)],
      [
        'platform',
        writeRuns(inputs.directory, 'linux-batch', 'batch', 1, 2000, metrics, {
          platform: { platform: 'linux', arch: 'arm64', cpus: 16 }
        })
      ],
      [
        'sampleIntervalMs',
        writeRuns(inputs.directory, 'slow-sampling-batch', 'batch', 1, 2000, metrics, {
          sampleIntervalMs: 500
        })
      ],
      [
        'configuredWorktrees',
        writeRuns(inputs.directory, 'small-fixture-batch', 'batch', 1, 2000, metrics, {
          worktrees: 99,
          lineageDepth: 98
        })
      ]
    ]

    for (const [expectedField, burstBatch] of cases) {
      expect(() =>
        generateRendererPerformanceHtmlReport({
          ...inputs,
          groups: { ...inputs.groups, burstBatch },
          outputPath: join(inputs.directory, `${expectedField}.html`)
        })
      ).toThrow(expectedField)
    }
  })

  it('rejects missing and over-budget terminal measurements', () => {
    const inputs = createInputs()
    const missingMetric = writeTerminalReport(
      inputs.directory,
      'panes=20 median=8.2ms worst=27.1ms rendererDroppedBacklogs=0',
      'terminal-missing.json'
    )
    const overBudget = writeTerminalReport(
      inputs.directory,
      'panes=20 median=76ms worst=27.1ms maxTimerDrift=16.9ms rendererDroppedBacklogs=0',
      'terminal-over-budget.json'
    )

    for (const terminalReportPath of [missingMetric, overBudget]) {
      expect(() =>
        generateRendererPerformanceHtmlReport({
          ...inputs,
          terminalReportPath,
          outputPath: join(inputs.directory, 'terminal-failure.html')
        })
      ).toThrow(/Missing finite|exceeded its budget/)
    }
  })
})
