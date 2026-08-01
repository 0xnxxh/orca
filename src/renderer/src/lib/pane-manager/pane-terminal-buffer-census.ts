/**
 * Retained size of live xterm buffers, in scrollback lines and cells.
 *
 * Why its own module: a PaneManager reads this straight off its internal pane map,
 * while the registry falls back to the public `getPanes()` view for managers that
 * do not expose one. Both funnel through here so the two paths cannot drift.
 */

type XtermBufferShape = { cols?: number; buffer?: { active?: { length?: number } } }

export type TerminalBufferCensus = { panes: number; lines: number; cells: number }

export function sumTerminalBufferSizes(
  managedPanes: Iterable<{ terminal: unknown }>
): TerminalBufferCensus {
  let panes = 0
  let lines = 0
  let cells = 0
  for (const pane of managedPanes) {
    try {
      const terminal = pane.terminal as XtermBufferShape | undefined
      // `buffer.active.length` and `cols` are both O(1); safe on the crash path.
      const length = terminal?.buffer?.active?.length ?? 0
      panes += 1
      lines += length
      cells += length * (terminal?.cols ?? 0)
    } catch {
      // Why: a disposed terminal throws on buffer access; siblings still count.
    }
  }
  return { panes, lines, cells }
}
