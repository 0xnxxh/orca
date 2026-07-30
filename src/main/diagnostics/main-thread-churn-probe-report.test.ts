import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { writeStartupDiagnosticLine } = vi.hoisted(() => ({
  writeStartupDiagnosticLine: vi.fn()
}))

vi.mock('../startup/startup-diagnostics', () => ({ writeStartupDiagnosticLine }))

import {
  MAIN_THREAD_DIAGNOSTICS_ENV,
  drainRemoteRpcRequestStats,
  drainSubprocessSpawnStats,
  recordRemoteRpcRequest,
  recordSubprocessSpawn,
  startMainThreadChurnProbe
} from './main-thread-churn-probe'

function lastReport(): Record<string, unknown> {
  const line = writeStartupDiagnosticLine.mock.calls.at(-1)?.[0]
  expect(line).toMatch(/^\[main-thread\] /)
  return JSON.parse(line.slice('[main-thread] '.length))
}

describe('main-thread churn report windows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv(MAIN_THREAD_DIAGNOSTICS_ENV, '1')
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    writeStartupDiagnosticLine.mockReset()
    drainSubprocessSpawnStats()
    drainRemoteRpcRequestStats()
  })

  it('drains subprocess and RPC counts into the same deterministic window', () => {
    startMainThreadChurnProbe()
    recordSubprocessSpawn('git', ['status'], 2)
    recordRemoteRpcRequest('git.status')
    recordRemoteRpcRequest('git.status')

    vi.advanceTimersByTime(5_000)

    expect(lastReport()).toMatchObject({
      spawnCount: 1,
      spawns: { 'git status': { count: 1, blockMsTotal: 2, blockMsMax: 2 } },
      rpcCount: 2,
      rpcs: { 'git.status': { count: 2 } }
    })

    vi.advanceTimersByTime(5_000)

    expect(lastReport()).toMatchObject({
      spawnCount: 0,
      spawns: {},
      rpcCount: 0,
      rpcs: {}
    })
  })

  it('does not schedule reporting while diagnostics are disabled', () => {
    vi.stubEnv(MAIN_THREAD_DIAGNOSTICS_ENV, '')

    startMainThreadChurnProbe()
    vi.advanceTimersByTime(5_000)

    expect(vi.getTimerCount()).toBe(0)
    expect(writeStartupDiagnosticLine).not.toHaveBeenCalled()
  })
})
