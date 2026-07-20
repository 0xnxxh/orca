import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { buildDefaultTerminalOptions } from '@/lib/pane-manager/pane-terminal-options'

const PREVIEW_SCROLLBACK_ROWS = 24
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Live peek at an agent's terminal, streaming from the main process's per-PTY
 * headless emulator. The terminal is created at the pane's REAL cols/rows —
 * the serialized ANSI was produced at those dimensions, and replaying it into
 * a narrower terminal rewraps every full-width line into garbage. The box
 * stays fixed; the oversized terminal is scaled down to fit the width and
 * bottom-anchored so the tail (prompt, status line) stays visible. Keystrokes
 * pass through to the PTY; DOM renderer so it never grabs a WebGL context.
 */
export function AgentTerminalPreview({ ptyId }: { ptyId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  // A null snapshot means no serializer knows this pty (it died or was never
  // spawned this session) — say so instead of painting a silent blank terminal.
  const [ptyGone, setPtyGone] = useState(false)

  useEffect(() => {
    setPtyGone(false)
    const container = containerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let terminal: Terminal | null = null
    let offData: (() => void) | null = null

    // Why: xterm auto-replies to query sequences embedded in written bytes
    // (CPR, DA1, OSC color queries). Everything this preview writes is a
    // replay — the headless emulator in main is the authoritative responder —
    // so forwarding those replies would inject stray input into the real PTY.
    // Mirror pty-connection's replay guard: drop onData while writes parse.
    const fitToBox = (): void => {
      const screen = container.querySelector<HTMLElement>('.xterm-screen')
      const box = container.parentElement
      if (!screen || !box || !terminal) {
        return
      }
      const scale = Math.min(1, box.clientWidth / Math.max(1, screen.offsetWidth))
      container.style.transform = scale < 1 ? `scale(${scale})` : ''
      // Anchor whichever end keeps the CURSOR row in view when the terminal is
      // taller than the box: a fresh shell prompts at the TOP of its screen
      // (blind bottom-anchoring clipped it away), while a busy TUI keeps its
      // action at the bottom.
      const cellHeight = screen.offsetHeight / Math.max(1, terminal.rows)
      const cursorBottom = (terminal.buffer.active.cursorY + 1) * cellHeight * scale
      const anchorTop = cursorBottom <= box.clientHeight
      box.style.alignItems = anchorTop ? 'flex-start' : 'flex-end'
      container.style.transformOrigin = anchorTop ? 'top left' : 'bottom left'
    }
    // Re-fit after every parsed write (cursor may move ends); rAF coalesces.
    let fitScheduled = false
    const scheduleFit = (): void => {
      if (fitScheduled) {
        return
      }
      fitScheduled = true
      requestAnimationFrame(() => {
        fitScheduled = false
        fitToBox()
      })
    }

    let replayDepth = 0
    const writeReplayed = (chunk: string, onDone?: () => void): void => {
      replayDepth++
      terminal?.write(chunk, () => {
        replayDepth--
        scheduleFit()
        onDone?.()
      })
    }

    const setup = async (): Promise<void> => {
      const snap = await window.api.terminalPreview.snapshot(ptyId, {
        scrollbackRows: PREVIEW_SCROLLBACK_ROWS
      })
      if (disposed) {
        return
      }
      if (!snap) {
        setPtyGone(true)
        return
      }
      terminal = new Terminal({
        ...buildDefaultTerminalOptions(),
        fontSize: 12,
        cols: clamp(snap?.cols ?? FALLBACK_COLS, 2, 500),
        rows: clamp(snap?.rows ?? FALLBACK_ROWS, 2, 200),
        // Why: scrollbar.width (from the default options) enables xterm's
        // overview ruler, whose border defaults to the foreground color and
        // paints a bright vertical line down the terminal's right edge — same
        // fix as composeActiveTerminalTheme.
        theme: {
          background: '#08090b',
          foreground: '#d6d6d6',
          overviewRulerBorder: 'transparent',
          scrollbarSliderBackground: 'rgba(180, 180, 185, 0.4)',
          scrollbarSliderHoverBackground: 'rgba(180, 180, 185, 0.6)',
          scrollbarSliderActiveBackground: 'rgba(180, 180, 185, 0.8)'
        },
        scrollback: 1000
      })
      try {
        terminal.open(container)
      } catch {
        terminal.dispose()
        terminal = null
        return
      }
      if (snap?.scrollbackAnsi) {
        writeReplayed(snap.scrollbackAnsi)
      }
      if (snap?.data) {
        writeReplayed(snap.data)
      }
      // Why: the withheld incomplete-escape tail must precede streamed chunks
      // or the continuation bytes parse as literal text.
      if (snap?.pendingEscapeTailAnsi) {
        writeReplayed(snap.pendingEscapeTailAnsi)
      }
      scheduleFit()
      // Why: the dialog suppresses Radix auto-focus so keystrokes can flow to
      // the agent immediately after opening.
      terminal.focus()
      terminal.onData((data) => {
        if (replayDepth > 0) {
          return
        }
        void window.api.terminalPreview.input(ptyId, data)
      })
      offData = window.api.terminalPreview.onData((payload) => {
        if (payload.ptyId === ptyId) {
          writeReplayed(payload.data)
        }
      })
      await window.api.terminalPreview.subscribe(ptyId)
    }

    void setup()

    return () => {
      disposed = true
      offData?.()
      void window.api.terminalPreview.unsubscribe(ptyId)
      terminal?.dispose()
    }
  }, [ptyId])

  if (ptyGone) {
    return (
      <div className="px-2.5 py-8 text-center text-[11px] text-muted-foreground">
        No live terminal — this agent&apos;s pane isn&apos;t running. Focus the worktree to wake it.
      </div>
    )
  }

  return (
    // Why: a size FIXED by the viewport (not shrink-to-fit) + overflow-hidden
    // keeps the dialog stable no matter how wide/tall the pane's serialized
    // buffer is. The terminal keeps the pane's true dimensions and is scaled/
    // clipped to fit; fitToBox anchors whichever end keeps the cursor in view.
    <div className="h-[calc(100vh-140px)] w-full overflow-hidden bg-[#08090b] p-1.5">
      <div className="flex h-full w-full items-end overflow-hidden">
        <div ref={containerRef} className="origin-bottom-left" />
      </div>
    </div>
  )
}
