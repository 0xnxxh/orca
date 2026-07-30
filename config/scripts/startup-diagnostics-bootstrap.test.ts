import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createStartupDiagnosticsBootstrapPrefix,
  createStartupDiagnosticsBootstrapSuffix
} from '../../build-plugins/startup-diagnostics-bootstrap'

function executeBootstrap(mode: string | undefined, applicationCode = '') {
  const lines: string[] = []
  const order: string[] = []
  const originalLoad = vi.fn()
  const moduleApi = { _load: originalLoad }
  const requireModule = vi.fn((id: string) => {
    if (id === 'node:fs') {
      return {
        closeSync: vi.fn(),
        openSync: vi.fn(),
        writeSync: (_fd: number, line: string) => {
          lines.push(line.trimEnd())
          order.push(line.includes('bundle-enter') ? 'bundle-enter' : 'evaluation-complete')
        }
      }
    }
    if (id === 'node:module') {
      return moduleApi
    }
    throw new Error(`Unexpected require: ${id}`)
  })
  const now = vi.fn().mockReturnValueOnce(4.25).mockReturnValueOnce(19.75)
  const processApi = {
    argv: ['electron', 'app with spaces'],
    env: mode ? { ORCA_STARTUP_DIAGNOSTICS: mode } : {},
    execPath: '/Applications/Orca App',
    on: vi.fn(),
    once: vi.fn(),
    pid: 12,
    ppid: 7
  }
  const record = (event: string) => order.push(event)
  const source =
    createStartupDiagnosticsBootstrapPrefix('index.js') +
    applicationCode +
    createStartupDiagnosticsBootstrapSuffix()

  const run = () =>
    vm.runInNewContext(source, {
      console,
      performance: { now },
      process: processApi,
      record,
      require: requireModule
    })

  return { lines, moduleApi, now, order, originalLoad, requireModule, run }
}

describe('startup diagnostics bootstrap', () => {
  it('wraps synchronous entry evaluation with ordered process-clock timestamps', () => {
    const execution = executeBootstrap('1', "record('application-evaluated');")

    execution.run()

    expect(execution.order).toEqual([
      'bundle-enter',
      'application-evaluated',
      'evaluation-complete'
    ])
    expect(execution.lines[0]).toContain(
      '[bootstrap] bundle-enter t=4.25 clock="process-performance-now-ms"'
    )
    expect(execution.lines[1]).toContain(
      '[bootstrap] bundle-evaluation-complete t=19.75 clock="process-performance-now-ms"'
    )
  })

  it('does not emit evaluation completion when entry evaluation throws', () => {
    const execution = executeBootstrap('1', "throw new Error('entry failed');")

    expect(execution.run).toThrow('entry failed')
    expect(execution.lines.some((line) => line.includes('bundle-evaluation-complete'))).toBe(false)
  })

  it('never loads or patches Module in normal diagnostics mode', () => {
    const execution = executeBootstrap('1')

    execution.run()

    expect(execution.requireModule).toHaveBeenCalledWith('node:fs')
    expect(execution.requireModule).not.toHaveBeenCalledWith('node:module')
    expect(execution.moduleApi._load).toBe(execution.originalLoad)
  })

  it('installs require tracing only in trace mode', () => {
    const execution = executeBootstrap('trace')

    execution.run()

    expect(execution.requireModule).toHaveBeenCalledWith('node:module')
    expect(execution.moduleApi._load).not.toBe(execution.originalLoad)
  })

  it('does no diagnostic work when disabled', () => {
    const execution = executeBootstrap(undefined, "record('application-evaluated');")

    execution.run()

    expect(execution.order).toEqual(['application-evaluated'])
    expect(execution.requireModule).not.toHaveBeenCalled()
    expect(execution.now).not.toHaveBeenCalled()
  })
})
