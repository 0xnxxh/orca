import { describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'
import type { HostSessionTerminalOperations } from './host-session-terminal-operations'
import { presentHostSessionTerminalStreamEvent } from './host-session-terminal-stream-presentation'
import type { MobileTerminalDiagnostics } from './mobile-terminal-diagnostics'

describe('host session terminal stream presentation', () => {
  it('ACKs snapshots and output only after the existing terminal surface parses them', () => {
    const acknowledge = vi.fn()
    const init = vi.fn()
    const write = vi.fn()
    const terminalRef = { init, write } as unknown as TerminalWebViewHandle
    const context = presentationContext({ acknowledge, terminalRef })

    presentHostSessionTerminalStreamEvent({
      ...context,
      event: {
        type: 'scrollback',
        cols: 80,
        rows: 24,
        serialized: new Uint8Array([112, 114, 111, 109, 112, 116]),
        throughSequence: 6
      }
    })
    expect(acknowledge).not.toHaveBeenCalled()
    expect(init).toHaveBeenCalledWith(
      80,
      24,
      new Uint8Array([112, 114, 111, 109, 112, 116]),
      false,
      undefined,
      expect.any(Function)
    )
    init.mock.calls[0]![5]()
    expect(acknowledge).toHaveBeenCalledWith('terminal-page-1', 6)

    presentHostSessionTerminalStreamEvent({
      ...context,
      event: {
        type: 'data',
        chunk: new Uint8Array([36, 32]),
        throughSequence: 8
      }
    })
    expect(acknowledge).toHaveBeenCalledTimes(1)
    write.mock.calls[0]![1]()
    expect(acknowledge).toHaveBeenLastCalledWith('terminal-page-1', 8)
  })

  it('does not resubscribe a desktop-mode snapshot to the phone viewport', () => {
    const awaitReady = vi.fn()
    const measureFitDimensions = vi.fn()
    const terminalRef = {
      init: vi.fn(),
      awaitReady,
      measureFitDimensions
    } as unknown as TerminalWebViewHandle
    const context = presentationContext({ acknowledge: vi.fn(), terminalRef })
    context.viewportRef.current = { cols: 50, rows: 36 }

    presentHostSessionTerminalStreamEvent({
      ...context,
      event: {
        type: 'scrollback',
        cols: 120,
        rows: 40,
        displayMode: 'desktop',
        serialized: new Uint8Array()
      }
    })

    expect(context.setDisplayMode).toHaveBeenCalledWith('terminal-page-1', 'desktop')
    expect(awaitReady).not.toHaveBeenCalled()
    expect(measureFitDimensions).not.toHaveBeenCalled()
    expect(context.unsubscribe).not.toHaveBeenCalled()
    expect(context.subscribe).not.toHaveBeenCalled()
  })
})

function presentationContext(args: {
  acknowledge: ReturnType<typeof vi.fn>
  terminalRef: TerminalWebViewHandle
}) {
  const operations = {
    acknowledge: args.acknowledge
  } as unknown as HostSessionTerminalOperations
  const diagnostics = {
    firstStreamEvent: vi.fn(),
    streamScrollback: vi.fn(),
    streamResubscribing: vi.fn(),
    streamResized: vi.fn()
  } as unknown as MobileTerminalDiagnostics
  return {
    handle: 'terminal-page-1',
    subscribeSequence: 1,
    currentSubscribeSequence: () => 1,
    isCovered: () => false,
    unsubscribe: vi.fn(),
    markInputLeaseReady: vi.fn(),
    layoutSequences: new Map<string, number>(),
    initializedHandles: new Set<string>(),
    terminalCwds: new Map<string, string>(),
    getTerminalRef: () => args.terminalRef,
    operations,
    setDisplayMode: vi.fn(),
    diagnostics,
    scheduleDelayedAction: vi.fn(),
    viewportRef: { current: { cols: 80, rows: 24 } },
    viewportMeasuredRef: { current: true },
    terminalFrameHeightRef: { current: 400 },
    subscribe: vi.fn()
  }
}
