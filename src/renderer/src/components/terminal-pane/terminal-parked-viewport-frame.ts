import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { serializeWithAbsoluteCursor } from '../../../../shared/terminal-serialize-absolute-cursor'
import { replayIntoTerminal, type ReplayingPanesRef } from './replay-guard'

const MAX_PARKED_VIEWPORT_FRAME_CHARS = 256 * 1024
const PARKED_VIEWPORT_FRAME_DATASET_KEY = 'parkedViewportFrame'

export type ParkedTerminalViewportFrame = {
  data: string
  cols: number
  rows: number
}

export type ParkedTerminalViewportFrameByLeaf = {
  leafId: string
  frame: ParkedTerminalViewportFrame
}

export function captureParkedTerminalPanes(
  manager: PaneManager,
  paneTransports: ReadonlyMap<number, PtyTransport>
): {
  ptyId: string | null
  paneId: number
  leafId: string
  drivesTabTitle: boolean
  viewportFrame?: ParkedTerminalViewportFrame
}[] {
  const activePaneId = manager.getActivePane()?.id
  return manager.getPanes().map((pane) => {
    const ptyId = paneTransports.get(pane.id)?.getPtyId() ?? null
    const viewportFrame =
      ptyId && isRemoteRuntimePtyId(ptyId) ? captureParkedTerminalViewportFrame(pane) : null
    return {
      ptyId,
      paneId: pane.id,
      leafId: pane.leafId,
      drivesTabTitle: activePaneId === pane.id,
      ...(viewportFrame ? { viewportFrame } : {})
    }
  })
}

export function captureParkedTerminalViewportFrame(
  pane: ManagedPane
): ParkedTerminalViewportFrame | null {
  try {
    if (pane.terminal.cols < 1 || pane.terminal.rows < 1) {
      return null
    }
    const data = serializeWithAbsoluteCursor(pane.serializeAddon, pane.terminal, {
      scrollback: 0
    })
    if (!data || data.length > MAX_PARKED_VIEWPORT_FRAME_CHARS) {
      return null
    }
    return { data, cols: pane.terminal.cols, rows: pane.terminal.rows }
  } catch {
    return null
  }
}

export function replayParkedTerminalViewportFrames(args: {
  manager: PaneManager
  frames: readonly ParkedTerminalViewportFrameByLeaf[]
  isVisible: () => boolean
  paneByLeafId: ReadonlyMap<string, number>
  replayingPanesRef: ReplayingPanesRef
}): number {
  let replayed = 0
  for (const { leafId, frame } of args.frames) {
    const paneId = args.paneByLeafId.get(leafId)
    const pane = args.manager.getPanes().find((candidate) => candidate.id === paneId)
    if (!pane || pane.terminal.cols !== frame.cols || pane.terminal.rows !== frame.rows) {
      continue
    }
    replayIntoTerminal(pane, args.replayingPanesRef, frame.data, {
      shouldRefreshViewportSynchronously: () => !args.manager.hasWebglRenderer(pane.id),
      shouldReleaseRenderPause: args.isVisible
    })
    pane.container.dataset[PARKED_VIEWPORT_FRAME_DATASET_KEY] = 'true'
    replayed += 1
  }
  return replayed
}

export function consumeParkedTerminalViewportFrameMarker(
  pane: Pick<ManagedPane, 'container'>
): boolean {
  if (pane.container.dataset[PARKED_VIEWPORT_FRAME_DATASET_KEY] !== 'true') {
    return false
  }
  delete pane.container.dataset[PARKED_VIEWPORT_FRAME_DATASET_KEY]
  return true
}
