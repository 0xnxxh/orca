import { describe, expect, it, vi } from 'vitest'
import {
  aggregateMainThreadDiagnosticReports,
  parseMainThreadDiagnosticLine,
  waitForMainThreadDiagnosticDrain
} from './main-thread-diagnostic-report.mjs'

describe('main-thread diagnostic benchmark reports', () => {
  it('parses reports and rejects unrelated or malformed lines', () => {
    expect(parseMainThreadDiagnosticLine('[main-thread] {"rpcCount":2}')).toEqual({ rpcCount: 2 })
    expect(parseMainThreadDiagnosticLine('[startup] {"rpcCount":2}')).toBeNull()
    expect(parseMainThreadDiagnosticLine('[main-thread] nope')).toBeNull()
  })

  it('aggregates subprocess, RPC, stall, and exact window totals', () => {
    expect(
      aggregateMainThreadDiagnosticReports([
        {
          windowDurationMs: 5_001,
          spawnCount: 2,
          rpcCount: 1,
          maxGapMs: 52,
          gapsOver50Ms: 1,
          spawns: {
            'git status': { count: 2, blockMsTotal: 1.25, blockMsMax: 0.75 }
          },
          rpcs: { 'git.status': { count: 1 } }
        },
        {
          windowDurationMs: 4_999,
          spawnCount: 1,
          rpcCount: 2,
          maxGapMs: 260,
          gapsOver250Ms: 1,
          spawns: {
            'git status': { count: 1, blockMsTotal: 0.5, blockMsMax: 0.5 }
          },
          rpcs: {
            'git.status': { count: 1 },
            'git.history': { count: 1 }
          }
        }
      ])
    ).toEqual({
      spawnCount: 3,
      rpcCount: 3,
      diagnosticWindowDurationMs: 10_000,
      maxGapMs: 260,
      gapsOver50Ms: 1,
      gapsOver250Ms: 1,
      perCommand: {
        'git status': { count: 3, blockMsTotal: 1.75, blockMsMax: 0.75 }
      },
      perRpcMethod: {
        'git.status': { count: 2 },
        'git.history': { count: 1 }
      }
    })
  })

  it('uses the next drain as the boundary before measured reports begin', async () => {
    const reports = [{ rpcCount: 9 }]
    const wait = vi.fn(async () => {
      reports.push({ rpcCount: 4 })
    })

    const measuredReportStartIndex = await waitForMainThreadDiagnosticDrain(reports, { wait })
    reports.push({ rpcCount: 2 }, { rpcCount: 1 })

    expect(measuredReportStartIndex).toBe(2)
    expect(
      aggregateMainThreadDiagnosticReports(reports.slice(measuredReportStartIndex))
    ).toMatchObject({ rpcCount: 3 })
  })
})
