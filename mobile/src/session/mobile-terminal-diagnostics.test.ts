import { describe, expect, it, vi } from 'vitest'
import {
  getMobileTerminalDiagnosticErrorName,
  logMobileTerminalDiagnostic,
  MobileTerminalDiagnostics,
  shortenMobileTerminalDiagnosticId
} from './mobile-terminal-diagnostics'

describe('mobile terminal diagnostics', () => {
  it('keeps only the correlatable suffix of identifiers', () => {
    expect(shortenMobileTerminalDiagnosticId('terminal-secret-prefix-12345678')).toBe('12345678')
    expect(shortenMobileTerminalDiagnosticId('short')).toBe('short')
    expect(shortenMobileTerminalDiagnosticId(null)).toBeNull()
  })

  it('reports thrown error types without copying potentially sensitive messages', () => {
    expect(getMobileTerminalDiagnosticErrorName(new TypeError('/private/worktree failed'))).toBe(
      'TypeError'
    )
    expect(getMobileTerminalDiagnosticErrorName('raw failure')).toBe('string')
  })

  it('uses one filterable structured log tag', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    logMobileTerminalDiagnostic('stream-armed', { handle: '12345678', seq: 2 })

    expect(log).toHaveBeenCalledWith('[terminal-diagnostic]', 'stream-armed', {
      handle: '12345678',
      seq: 2
    })
    log.mockRestore()
  })

  it('forgets first-event state when a terminal unsubscribes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const diagnostics = new MobileTerminalDiagnostics()

    diagnostics.firstStreamEvent('terminal-1', 1, 'subscribed')
    diagnostics.terminalUnsubscribed('terminal-1')
    diagnostics.firstStreamEvent('terminal-1', 1, 'subscribed')

    expect(log).toHaveBeenCalledTimes(2)
    log.mockRestore()
  })

  it('waits for a rendered terminal pane, then samples once across effect replay', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const readProcessMemory = vi.fn(async () => ({
      platform: 'ios' as const,
      supportStatus: 'supported' as const,
      processRole: 'app' as const,
      pid: 41,
      metric: 'physical-footprint' as const,
      bytes: 12_345,
      byteUnit: 'bytes' as const,
      sampledAtMs: 77,
      webContentProcessAttribution: 'unsupported-unattributed' as const,
      limitation: 'public-sandbox-api-unavailable' as const,
      errorKind: null
    }))
    const diagnostics = new MobileTerminalDiagnostics(true, readProcessMemory)

    await diagnostics.sampleProcessMemoryOnce('ios', {
      terminalRecordsLoaded: false,
      renderedTerminalPaneCount: 1
    })
    await diagnostics.sampleProcessMemoryOnce('ios', {
      terminalRecordsLoaded: true,
      renderedTerminalPaneCount: 0
    })
    await Promise.all(
      Array.from({ length: 2 }, () =>
        diagnostics.sampleProcessMemoryOnce('ios', {
          terminalRecordsLoaded: true,
          renderedTerminalPaneCount: 1
        })
      )
    )

    expect(readProcessMemory).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  it('does not load native process-memory diagnostics while disabled', async () => {
    const readProcessMemory = vi.fn()
    const diagnostics = new MobileTerminalDiagnostics(false, readProcessMemory)

    await diagnostics.sampleProcessMemoryOnce('ios', {
      terminalRecordsLoaded: true,
      renderedTerminalPaneCount: 1
    })

    expect(readProcessMemory).not.toHaveBeenCalled()
  })

  it('keeps actual terminal records distinct from terminal and total tab counts', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const diagnostics = new MobileTerminalDiagnostics(true)
    const tabs = [
      { id: 'ready', type: 'terminal', terminal: 'pty-1', isActive: true },
      { id: 'pending', type: 'terminal', terminal: null, isActive: false },
      { id: 'browser', type: 'browser', isActive: false }
    ]

    diagnostics.tabsApplied({ snapshotVersion: 1, tabs }, tabs, 3, tabs[0], 'snapshot')

    expect(log).toHaveBeenCalledWith(
      '[terminal-diagnostic]',
      'webview-count-snapshot',
      expect.objectContaining({
        terminalRecordCount: 3,
        terminalTabCount: 2,
        tabCount: 3
      })
    )
    log.mockRestore()
  })
})
