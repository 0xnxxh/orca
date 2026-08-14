// @vitest-environment happy-dom
/**
 * Does the pane still SHOW its content after X?
 *
 * Every other pane test asserts a pane is bound to a pty, or that a repaint spy was called.
 * A blank-but-attached pane passes all of them — and that is the bug users keep reporting:
 * after an SSH reconnect, a restore, or a tab reveal the terminal comes back empty until a
 * resize or a sidebar toggle forces a relayout. These tests run the real PaneManager over
 * real xterm terminals and assert against the PAINTED rows plus the buffer, so "repainted"
 * means the content is back on screen and unchanged, not that a mock was invoked.
 *
 * Axes covered here: reconnect/bulk-restore refit, tab reveal, window show, split, unsplit;
 * single pane, split panes, more than one tab; plain shell scrollback and an agent TUI's
 * alternate-screen frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blankPaintedLayer,
  bufferText,
  createPaneTab,
  destroyPaneTabs,
  paintedText,
  settleFrames,
  stubTerminalTextMeasurement,
  writeAlternateScreenFrame,
  writeToPane
} from './painted-pane-fixture'
import { refitAndRefreshAllTerminalPanes } from './pane-manager-registry'

const SHELL_SCROLLBACK = ['$ git status', 'nothing to commit', '$ '].join('\r\n')
const TUI_FRAME = ['╭─ claude ─────╮', '│ waiting…     │', '╰──────────────╯']

beforeEach(() => {
  stubTerminalTextMeasurement()
})

afterEach(() => {
  destroyPaneTabs()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('content survives an SSH reconnect / bulk restore refit', () => {
  // Deleting this test lets PaneManager.refreshAllPanes stop repainting (or repaint a
  // narrower row range) with no test noticing: the reported symptom is a plain shell whose
  // scrollback is in the buffer but not on screen after reconnect.
  it('repaints a single plain-shell pane from its buffer without touching the scrollback', async () => {
    const { manager } = createPaneTab()
    const pane = manager.createInitialPane({ focus: false })
    await writeToPane(pane, SHELL_SCROLLBACK)
    await settleFrames(30)
    const content = bufferText(pane)
    expect(paintedText(pane)).toContain('nothing to commit')

    blankPaintedLayer(pane)
    expect(paintedText(pane), 'the pane must actually be blank before the repaint').toBe('')

    refitAndRefreshAllTerminalPanes()
    await settleFrames(30)

    expect(paintedText(pane)).toContain('nothing to commit')
    expect(paintedText(pane)).toContain('$ git status')
    expect(bufferText(pane), 'a repaint must not scroll, clear, or reflow the buffer').toBe(content)
  })

  // Deleting this test lets the repaint stop after the first pane of a split (the reported
  // case had splits open); one blank half of a split is the same bug, half-visible.
  it('repaints every pane of a split, not just the active one', async () => {
    const { manager } = createPaneTab()
    const first = manager.createInitialPane({ focus: false })
    const second = manager.splitPane(first.id, 'vertical')
    if (!second) {
      throw new Error('expected the split to create a second pane')
    }
    await writeToPane(first, 'left pane output')
    await writeToPane(second, 'right pane output')
    await settleFrames(30)

    blankPaintedLayer(first)
    blankPaintedLayer(second)
    refitAndRefreshAllTerminalPanes()
    await settleFrames(30)

    expect(paintedText(first)).toContain('left pane output')
    expect(paintedText(second)).toContain('right pane output')
  })

  // Deleting this test lets someone bound the reconnect repaint to visible managers the way
  // resetAndRefreshAllTerminalWebglAtlases already is. A reconnect rebinds every tab's panes,
  // so a background tab would then stay blank until it is revealed AND resized.
  it('repaints background tabs too, not only the foreground one', async () => {
    const foreground = createPaneTab()
    const background = createPaneTab({ background: true })
    const visible = foreground.manager.createInitialPane({ focus: false })
    const hidden = background.manager.createInitialPane({ focus: false })
    await writeToPane(visible, 'foreground tab output')
    await writeToPane(hidden, 'background tab output')
    await settleFrames(30)
    expect(background.manager.isVisibleForAtlasRecovery()).toBe(false)

    blankPaintedLayer(visible)
    blankPaintedLayer(hidden)
    refitAndRefreshAllTerminalPanes()
    await settleFrames(30)

    expect(paintedText(visible)).toContain('foreground tab output')
    expect(paintedText(hidden)).toContain('background tab output')
  })

  // Deleting this test removes the only coverage that the reconnect repaint restores an
  // alternate-screen frame. A TUI repaints itself on resize and a plain shell does not, which
  // is why plain shells showed the bug more visibly — but a reconnect resizes nothing, and a
  // TUI whose far side is idle will never redraw itself. The repaint must not depend on a
  // resize, and it must not lose the frame (alt-screen content has no scrollback to recover).
  it('restores an agent TUI alternate-screen frame without resizing the terminal', async () => {
    const { manager } = createPaneTab()
    const pane = manager.createInitialPane({ focus: false })
    await writeToPane(pane, SHELL_SCROLLBACK)
    await writeAlternateScreenFrame(pane, TUI_FRAME)
    await settleFrames(30)
    const grid = { cols: pane.terminal.cols, rows: pane.terminal.rows }
    expect(pane.terminal.buffer.active.type).toBe('alternate')

    blankPaintedLayer(pane)
    refitAndRefreshAllTerminalPanes()
    await settleFrames(30)

    expect(paintedText(pane)).toContain('waiting…')
    expect({ cols: pane.terminal.cols, rows: pane.terminal.rows }).toEqual(grid)
    expect(pane.terminal.buffer.active.type, 'the TUI must stay on its own screen').toBe(
      'alternate'
    )
  })

  // Deleting this test drops the Orca-restart shape: panes are rehydrated from a snapshot
  // while their tab is still background/rendering-suspended, and the restore's own writes are
  // the only paint they ever get. If the settled refit skips them the relaunched app opens on
  // a blank terminal.
  it('paints a background tab hydrated by a restore while its rendering was suspended', async () => {
    const tab = createPaneTab({ background: true })
    const pane = tab.manager.createInitialPane({ focus: false })
    tab.manager.suspendRendering()
    await writeToPane(pane, '$ restored from snapshot\r\n')
    // Why settle first: xterm's own render is rAF-debounced, so blanking before it lands
    // would let the restore's pending paint — not the code under test — repaint the pane.
    await settleFrames(30)
    blankPaintedLayer(pane)

    tab.manager.resumeRendering()
    tab.manager.setAtlasRecoveryVisible(true)
    refitAndRefreshAllTerminalPanes()
    await settleFrames(30)

    expect(paintedText(pane)).toContain('restored from snapshot')
  })
})

describe('content survives a tab reveal', () => {
  // Deleting this test lets PaneManager.scheduleRevealRepaint stop reaching the revealed
  // tab's panes: the background-tab-revealed blank, with both content kinds in one split.
  it('repaints both a plain pane and a TUI pane of the revealed tab', async () => {
    const tab = createPaneTab({ background: true })
    const shell = tab.manager.createInitialPane({ focus: false })
    const tui = tab.manager.splitPane(shell.id, 'horizontal')
    if (!tui) {
      throw new Error('expected the split to create a second pane')
    }
    await writeToPane(shell, SHELL_SCROLLBACK)
    await writeAlternateScreenFrame(tui, TUI_FRAME)
    tab.manager.suspendRendering()
    await settleFrames(30)
    blankPaintedLayer(shell)
    blankPaintedLayer(tui)

    // The reveal order TerminalPane uses: resume rendering and mark visible, then repaint.
    tab.manager.resumeRendering()
    tab.manager.setAtlasRecoveryVisible(true)
    tab.manager.scheduleRevealRepaint()
    await settleFrames()

    expect(paintedText(shell)).toContain('nothing to commit')
    expect(paintedText(tui)).toContain('waiting…')
  })

  // Deleting this test drops the ordering constraint that made reveals blank in the first
  // place: the settled repaint only reaches managers that are already marked visible, so a
  // reveal that schedules the repaint before marking the tab visible paints nothing.
  it('does not reach a tab that has not been marked visible yet', async () => {
    const tab = createPaneTab({ background: true })
    const pane = tab.manager.createInitialPane({ focus: false })
    await writeToPane(pane, 'still hidden')
    await settleFrames(30)
    blankPaintedLayer(pane)

    tab.manager.scheduleRevealRepaint()
    await settleFrames()

    expect(paintedText(pane), 'an unrevealed tab is skipped — reveal must mark visible first').toBe(
      ''
    )
  })
})

describe('content survives a window hide/show', () => {
  // Deleting this test lets the plain-refocus present path stop presenting. A window that was
  // occluded never hid its panes, so nothing re-writes them; without the present they keep
  // showing whatever the compositor dropped.
  it('presents already-visible panes of every open tab', async () => {
    const first = createPaneTab()
    const second = createPaneTab()
    const firstPane = first.manager.createInitialPane({ focus: false })
    const secondPane = second.manager.createInitialPane({ focus: false })
    await writeToPane(firstPane, 'tab one output')
    await writeToPane(secondPane, 'tab two output')
    await settleFrames(30)
    blankPaintedLayer(firstPane)
    blankPaintedLayer(secondPane)

    first.manager.scheduleRevealPresent()
    second.manager.scheduleRevealPresent()
    await settleFrames()

    expect(paintedText(firstPane)).toContain('tab one output')
    expect(paintedText(secondPane)).toContain('tab two output')
  })
})

describe('content survives a split and an unsplit', () => {
  // Deleting this test lets the split path start over on the source pane's terminal. The
  // split reparents that pane's live DOM subtree; its scrollback and painted frame must come
  // through the move, and the new pane must not inherit them.
  it('keeps the source pane painted when a split reparents it', async () => {
    const { manager } = createPaneTab()
    const source = manager.createInitialPane({ focus: false })
    await writeToPane(source, SHELL_SCROLLBACK)
    await settleFrames(30)
    const content = bufferText(source)

    const created = manager.splitPane(source.id, 'vertical')
    if (!created) {
      throw new Error('expected the split to create a second pane')
    }
    await settleFrames()

    expect(bufferText(source)).toBe(content)
    expect(paintedText(source)).toContain('nothing to commit')
    expect(paintedText(created), 'a fresh split pane starts empty').toBe('')
  })

  // Deleting this test lets the unsplit promote a survivor that is blank. closePane
  // reparents the surviving pane with replaceChild — the same DOM move the split path
  // explicitly compensates for — and only refits it; if the refit is a no-op because the
  // pane's box did not change, nothing else repaints it.
  it('keeps the surviving pane painted after the other half closes', async () => {
    const { manager } = createPaneTab()
    const survivor = manager.createInitialPane({ focus: false })
    const doomed = manager.splitPane(survivor.id, 'vertical')
    if (!doomed) {
      throw new Error('expected the split to create a second pane')
    }
    await writeToPane(survivor, SHELL_SCROLLBACK)
    await settleFrames(30)
    const content = bufferText(survivor)

    manager.closePane(doomed.id)
    await settleFrames()

    expect(manager.getPanes()).toHaveLength(1)
    expect(bufferText(survivor)).toBe(content)
    expect(paintedText(survivor)).toContain('nothing to commit')
  })
})
