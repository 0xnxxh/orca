// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebTerminalEvent } from '../../shared/mobile-web/terminal-stream-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebTerminal } from './mobile-web-terminal'

const STREAM_ID = 'T'.repeat(22)
const xterm = vi.hoisted(() => {
  class FakeTerminal {
    readonly cols = 80
    readonly rows = 24
    readonly writes: { data: Uint8Array; callback?: () => void }[] = []
    input: ((data: string) => void) | null = null
    disposed = false
    focused = false
    linkProvider: unknown = null
    linkProviderDisposed = false
    resetCount = 0

    constructor() {
      terminals.push(this)
    }

    loadAddon(): void {}
    open(): void {}
    focus(): void {
      this.focused = true
    }
    onData(input: (data: string) => void): { dispose: () => void } {
      this.input = input
      return { dispose: () => (this.input = null) }
    }
    registerLinkProvider(provider: unknown): { dispose: () => void } {
      this.linkProvider = provider
      return { dispose: () => (this.linkProviderDisposed = true) }
    }
    write(data: Uint8Array, callback?: () => void): void {
      this.writes.push({ data, callback })
    }
    reset(): void {
      this.resetCount += 1
    }
    dispose(): void {
      this.disposed = true
    }
  }
  class FakeFitAddon {
    fit(): void {}
  }
  const terminals: FakeTerminal[] = []
  return { FakeTerminal, FakeFitAddon, terminals }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: xterm.FakeFitAddon }))

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  disconnected = false

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true
  }
}

beforeEach(() => {
  xterm.terminals.length = 0
  FakeResizeObserver.instances.length = 0
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

afterEach(cleanup)

describe('MobileWebTerminal', () => {
  it('ACKs output only after xterm writes and tears down its subscription', async () => {
    const harness = clientHarness()
    const view = render(
      createElement(MobileWebTerminal, {
        client: harness.client,
        workspaceId: 'workspace-1',
        tabId: 'terminal-1',
        connected: true
      })
    )
    const terminal = xterm.terminals[0]!
    expect(harness.terminalSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        tabId: 'terminal-1',
        viewport: { cols: 80, rows: 24 },
        visible: true
      }),
      expect.any(Function),
      expect.any(Function)
    )
    expect(terminal.focused).toBe(true)

    act(() => harness.event(subscribed()))
    act(() =>
      harness.event({
        type: 'output',
        streamId: STREAM_ID,
        startSequence: 0,
        endSequence: 2,
        data: 'b2s='
      })
    )
    expect(harness.terminalRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'ack' })
    )
    act(() => terminal.writes[0]!.callback?.())
    await vi.waitFor(() =>
      expect(harness.terminalRequest).toHaveBeenCalledWith({
        operation: 'ack',
        streamId: STREAM_ID,
        throughSequence: 2
      })
    )

    view.unmount()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(terminal.disposed).toBe(true)
    expect(terminal.linkProviderDisposed).toBe(true)
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true)
  })

  it('sends one resync per gap and revokes input while hidden', async () => {
    const harness = clientHarness()
    render(
      createElement(MobileWebTerminal, {
        client: harness.client,
        workspaceId: 'workspace-1',
        tabId: 'terminal-1',
        connected: true
      })
    )
    const terminal = xterm.terminals[0]!
    act(() => harness.event(subscribed()))
    act(() => {
      harness.event(outputAt(4))
      harness.event(outputAt(4))
    })
    await vi.waitFor(() => {
      const resyncs = harness.terminalRequest.mock.calls.filter(
        ([request]) => request.operation === 'resync'
      )
      expect(resyncs).toHaveLength(1)
    })

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await vi.waitFor(() =>
      expect(harness.terminalRequest).toHaveBeenCalledWith({
        operation: 'visibility',
        streamId: STREAM_ID,
        visible: false
      })
    )
    act(() => terminal.input?.('x'))
    expect(
      harness.terminalRequest.mock.calls.filter(([request]) => request.operation === 'input')
    ).toHaveLength(0)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await vi.waitFor(() =>
      expect(harness.terminalRequest).toHaveBeenCalledWith({
        operation: 'visibility',
        streamId: STREAM_ID,
        visible: true
      })
    )
    act(() => harness.event(subscribed()))
    act(() => terminal.input?.('x'))
    await vi.waitFor(() =>
      expect(harness.terminalRequest).toHaveBeenCalledWith({
        operation: 'input',
        streamId: STREAM_ID,
        sequence: 0,
        data: 'eA=='
      })
    )
  })
})

function clientHarness(): {
  client: MobileWebBridgeClient
  terminalSubscribe: ReturnType<typeof vi.fn>
  terminalRequest: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  event: (event: MobileWebTerminalEvent) => void
} {
  let onEvent = (_event: MobileWebTerminalEvent): void => {}
  const unsubscribe = vi.fn()
  const terminalSubscribe = vi.fn((_payload, nextEvent: typeof onEvent) => {
    onEvent = nextEvent
    return { streamId: STREAM_ID, ready: Promise.resolve(), unsubscribe }
  })
  const terminalRequest = vi.fn().mockResolvedValue(null)
  const client = { terminalSubscribe, terminalRequest } as unknown as MobileWebBridgeClient
  return {
    client,
    terminalSubscribe,
    terminalRequest,
    unsubscribe,
    event: (event) => onEvent(event)
  }
}

function subscribed(): MobileWebTerminalEvent {
  return {
    type: 'subscribed',
    streamId: STREAM_ID,
    viewport: { cols: 80, rows: 24 },
    startSequence: 0,
    maxOutstandingBytes: 256 * 1024,
    inputFloor: 'held',
    queryReplyAuthority: true
  }
}

function outputAt(startSequence: number): MobileWebTerminalEvent {
  return {
    type: 'output',
    streamId: STREAM_ID,
    startSequence,
    endSequence: startSequence + 1,
    data: 'eA=='
  }
}
