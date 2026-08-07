import type { Terminal } from '@xterm/xterm'
import { planPreviewFitScale } from './preview-terminal-fit-scale'

/**
 * Fits the preview terminal into its box without resampling blur: shrink the
 * font (same cols/rows, so replayed content never rewraps) and keep a CSS
 * transform only for the sliver the half-px font step cannot express (see
 * planPreviewFitScale). Anchors whichever end keeps the cursor row in view.
 */
export function createPreviewFitScheduler(args: {
  container: HTMLElement
  getTerminal: () => Terminal | null
  getBaseFontSize: () => number
}): { scheduleFit: () => void } {
  const { container, getTerminal, getBaseFontSize } = args

  const fitToBox = (): void => {
    const terminal = getTerminal()
    const screen = container.querySelector<HTMLElement>('.xterm-screen')
    const box = container.parentElement
    if (!screen || !box || !terminal) {
      return
    }
    const baseFontSize = getBaseFontSize()
    const plan = planPreviewFitScale({
      boxWidth: box.clientWidth,
      screenWidth: Math.max(1, screen.offsetWidth),
      currentFontSize: terminal.options.fontSize ?? baseFontSize,
      baseFontSize
    })
    if (plan.fontSize !== terminal.options.fontSize) {
      terminal.options.fontSize = plan.fontSize
      // Re-measure next frame: the renderer applies the new metrics async.
      scheduleFit()
    }
    const scale = plan.residualScale
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
  return { scheduleFit }
}
