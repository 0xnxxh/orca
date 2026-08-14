/**
 * Test fixture: a real PaneManager driving real @xterm/xterm panes whose
 * PAINTED layer is observable, not just their buffer.
 *
 * Why it exists: every other pane test stubs `terminal` as `{ cols, rows, refresh: vi.fn() }`,
 * so "the pane repainted" degrades to "we called a spy". The bugs that keep shipping are
 * blank-but-attached panes — the buffer is right and the presented frame is not. Under
 * happy-dom xterm falls back to its DOM renderer, whose `.xterm-rows` subtree IS the
 * presented frame: what the user would see. `blankPaintedLayer` models a renderer that is
 * compositing nothing (stale/blank pixels) while the buffer is intact, which is exactly the
 * reported reconnect/reveal symptom; production repaint paths must bring it back.
 */
import { Terminal } from '@xterm/xterm'
import { vi } from 'vitest'
import { PaneManager } from './pane-manager'
import type { ManagedPane } from './pane-manager-types'

/** xterm's WidthCache needs a 2D context to open a terminal at all. */
export function stubTerminalTextMeasurement(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: () => ({ width: 10 })
  } as unknown as CanvasRenderingContext2D)
}

export type PaneTab = {
  manager: PaneManager
  root: HTMLElement
}

const liveTabs: PaneTab[] = []

/** One tab = one PaneManager, exactly as TerminalPane mounts them. */
export function createPaneTab(opts: { background?: boolean } = {}): PaneTab {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const manager = new PaneManager(root, {
    linkOpenHint: () => 'open',
    ...(opts.background ? { initialRenderingSuspended: true } : {})
  })
  const tab: PaneTab = { manager, root }
  liveTabs.push(tab)
  return tab
}

/** Destroys every tab created by the fixture; PaneManager.destroy unregisters
 *  it from the module-global live-manager registry the repaint paths walk. */
export function destroyPaneTabs(): void {
  for (const tab of liveTabs.splice(0)) {
    tab.manager.destroy()
    tab.root.remove()
  }
}

export function writeToPane(pane: ManagedPane, data: string): Promise<void> {
  return new Promise((resolve) => pane.terminal.write(data, resolve))
}

/** Enter the alternate screen and paint a frame, as an agent TUI does. Alt-screen
 *  content has no scrollback and does not reflow: only a repaint or a fresh write
 *  from the far side can restore it. */
export async function writeAlternateScreenFrame(pane: ManagedPane, lines: string[]): Promise<void> {
  await writeToPane(pane, `\x1b[?1049h\x1b[2J\x1b[H${lines.join('\r\n')}`)
}

function rowsElement(pane: ManagedPane): Element | null {
  return pane.terminal.element?.querySelector('.xterm-rows') ?? null
}

/** What the user sees: the DOM renderer's presented rows. */
export function paintedText(pane: ManagedPane): string {
  return (rowsElement(pane)?.textContent ?? '').trim()
}

/** Models a renderer presenting nothing while the buffer is untouched — the
 *  blank-but-attached pane users report after a reconnect or a tab reveal. */
export function blankPaintedLayer(pane: ManagedPane): void {
  for (const row of Array.from(rowsElement(pane)?.children ?? [])) {
    row.textContent = ''
  }
}

/** Buffer text including scrollback, so paint assertions can be separated from
 *  content loss (a repaint that scrolls or clears is not a repaint). */
export function bufferText(pane: ManagedPane): string {
  const buffer = pane.terminal.buffer.active
  const lines: string[] = []
  for (let y = 0; y < buffer.length; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? '')
  }
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop()
  }
  return lines.join('\n')
}

/** Lets the double-rAF settled-frame schedulers and the 100ms settled pass run. */
export function settleFrames(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
