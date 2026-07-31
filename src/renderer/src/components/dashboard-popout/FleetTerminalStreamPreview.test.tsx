// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalPreviewDataPayload } from '../../../../shared/terminal-preview'

const terminalHarness = vi.hoisted(() => ({
  instances: [] as {
    options: Record<string, unknown>
    write: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
  }[]
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    write = vi.fn((_data: string, callback?: () => void) => callback?.())
    open = vi.fn()
    dispose = vi.fn()
    resize = vi.fn()
    reset = vi.fn()

    constructor(options: Record<string, unknown>) {
      terminalHarness.instances.push({
        options,
        write: this.write,
        open: this.open,
        dispose: this.dispose,
        resize: this.resize,
        reset: this.reset
      })
    }
  }
}))

import { FleetTerminalStreamPreview } from './FleetTerminalStreamPreview'

describe('FleetTerminalStreamPreview', () => {
  const connect = vi.fn()
  const ack = vi.fn(async () => {})
  const unsubscribe = vi.fn(async () => {})
  const input = vi.fn(async () => true)
  const fit = vi.fn(async () => null)
  const offData = vi.fn()
  let emitData: ((payload: TerminalPreviewDataPayload) => void) | null

  beforeEach(() => {
    terminalHarness.instances.length = 0
    emitData = null
    connect.mockResolvedValue({
      snapshot: {
        data: 'screen',
        cols: 80,
        rows: 24,
        seq: 1,
        scrollbackAnsi: 'history'
      },
      replay: ['live replay']
    })
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.assign(window, {
      api: {
        terminalPreview: {
          connect,
          ack,
          unsubscribe,
          input,
          fit,
          onData: (listener: (payload: TerminalPreviewDataPayload) => void) => {
            emitData = listener
            return offData
          }
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('streams bounded read-only output without claiming or writing to the PTY', async () => {
    const view = render(<FleetTerminalStreamPreview ptyId="pty-1" />)

    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    expect(connect).toHaveBeenCalledWith('pty-1', { scrollbackRows: 12 })
    expect(terminal.options).toMatchObject({ disableStdin: true, scrollback: 100 })
    expect(terminal.write).toHaveBeenCalledWith('history', expect.any(Function))
    expect(terminal.write).toHaveBeenCalledWith('screen', expect.any(Function))
    expect(terminal.write).toHaveBeenCalledWith('live replay', expect.any(Function))

    act(() => {
      emitData?.({ type: 'data', ptyId: 'pty-1', data: 'next frame', bytes: 10 })
    })
    expect(terminal.write).toHaveBeenCalledWith('next frame', expect.any(Function))
    expect(ack).toHaveBeenCalledWith('pty-1', 10)
    expect(fit).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()

    view.unmount()
    expect(offData).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledWith('pty-1')
    expect(terminal.dispose).toHaveBeenCalledOnce()
  })
})
