import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { translate } from '@/i18n/i18n'
import type { TerminalPreviewDataPayload } from '../../../../shared/terminal-preview'

const HOVER_SCROLLBACK_ROWS = 12

/** Read-only live stream for hover/focus. It never claims the PTY grid or forwards input. */
export function FleetTerminalStreamPreview({ ptyId }: { ptyId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ptyGone, setPtyGone] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let terminal: Terminal | null = null
    let connecting = false
    let reconnectRequested = false
    let pending: Extract<TerminalPreviewDataPayload, { type: 'data' }>[] = []
    let fitFrame: number | null = null

    const fit = (): void => {
      if (fitFrame !== null) {
        return
      }
      fitFrame = requestAnimationFrame(() => {
        fitFrame = null
        const screen = container.querySelector<HTMLElement>('.xterm-screen')
        if (!screen) {
          return
        }
        const scale = Math.min(
          1,
          container.clientWidth / Math.max(1, screen.offsetWidth),
          container.clientHeight / Math.max(1, screen.offsetHeight)
        )
        container.style.transform = scale < 1 ? `scale(${scale})` : ''
      })
    }

    const write = (data: string, callback?: () => void): void => {
      terminal?.write(data, () => {
        fit()
        callback?.()
      })
    }

    const writeLive = (payload: Extract<TerminalPreviewDataPayload, { type: 'data' }>): void => {
      if (!terminal) {
        pending.push(payload)
        return
      }
      write(payload.data, () => {
        if (!disposed) {
          void window.api.terminalPreview.ack(ptyId, payload.bytes)
        }
      })
    }

    const connect = async (replace = false): Promise<void> => {
      if (connecting) {
        reconnectRequested = true
        return
      }
      connecting = true
      const connection = await window.api.terminalPreview.connect(ptyId, {
        scrollbackRows: HOVER_SCROLLBACK_ROWS
      })
      connecting = false
      if (disposed) {
        void window.api.terminalPreview.unsubscribe(ptyId)
        return
      }
      const snapshot = connection.snapshot
      if (!snapshot) {
        setPtyGone(true)
        terminal?.dispose()
        terminal = null
        return
      }
      if (!terminal) {
        const styles = getComputedStyle(container)
        terminal = new Terminal({
          cols: Math.max(2, snapshot.cols),
          rows: Math.max(2, snapshot.rows),
          disableStdin: true,
          cursorBlink: false,
          scrollback: 100,
          fontSize: 10,
          fontFamily: styles.getPropertyValue('--font-mono').trim(),
          theme: {
            background: styles.getPropertyValue('--background').trim(),
            foreground: styles.getPropertyValue('--foreground').trim()
          }
        })
        terminal.open(container)
      } else if (replace) {
        terminal.resize(Math.max(2, snapshot.cols), Math.max(2, snapshot.rows))
        terminal.reset()
      }
      for (const data of [
        snapshot.scrollbackAnsi,
        snapshot.data,
        snapshot.pendingEscapeTailAnsi,
        ...connection.replay
      ]) {
        if (data) {
          write(data)
        }
      }
      for (const payload of pending) {
        writeLive(payload)
      }
      pending = []
      if (connection.resyncRequired || reconnectRequested) {
        reconnectRequested = false
        void connect(true)
      }
      fit()
    }

    const offData = window.api.terminalPreview.onData((payload) => {
      if (payload.ptyId !== ptyId) {
        return
      }
      if (payload.type === 'resync') {
        void connect(true)
      } else {
        writeLive(payload)
      }
    })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(container)
    void connect()

    return () => {
      disposed = true
      offData()
      observer?.disconnect()
      if (fitFrame !== null) {
        cancelAnimationFrame(fitFrame)
      }
      void window.api.terminalPreview.unsubscribe(ptyId)
      terminal?.dispose()
    }
  }, [ptyId])

  return (
    <div
      className="relative h-32 overflow-hidden bg-background"
      aria-label={translate('dashboardPopout.rings.liveTerminalPreview', 'Live terminal preview')}
    >
      {ptyGone ? (
        <div className="absolute inset-0 grid place-items-center px-3 text-center text-[11px] text-muted-foreground">
          {translate(
            'dashboardPopout.terminal.closed',
            "No live terminal — this agent's pane has closed."
          )}
        </div>
      ) : null}
      <div
        ref={containerRef}
        aria-hidden={ptyGone || undefined}
        className="h-full w-full origin-top-left p-1.5"
      />
    </div>
  )
}
