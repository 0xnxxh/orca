import type { ManagedPaneInternal } from './pane-manager-types'
import { safeFit } from './pane-tree-ops'
import {
  attachWebgl,
  clearTerminalWebglAttachBackoff,
  disposeWebgl,
  markComplexScriptOutput,
  resetWebglTextureAtlas
} from './pane-webgl-renderer'
import {
  releaseRetainedWebglPane,
  retainSuspendedWebglPane,
  shouldRetainSuspendedWebglContexts
} from './pane-webgl-context-retention'
import { reattachWebglIfNeeded } from './pane-webgl-reattach'

export function setPaneGpuRenderingState(
  panes: Map<number, ManagedPaneInternal>,
  paneId: number,
  enabled: boolean
): void {
  const pane = panes.get(paneId)
  if (!pane) {
    return
  }
  pane.gpuRenderingEnabled = enabled
  if (!enabled) {
    disposeWebgl(pane, { refreshDimensions: true })
    return
  }
  if (pane.webglAttachmentDeferred || pane.webglDisabledAfterContextLoss) {
    return
  }
  if (!pane.webglAddon) {
    attachWebgl(pane)
    safeFit(pane)
  }
}

export function markPaneComplexScriptOutput(
  panes: Map<number, ManagedPaneInternal>,
  paneId: number
): void {
  const pane = panes.get(paneId)
  if (pane) {
    markComplexScriptOutput(pane)
  }
}

export function suspendPaneRendering(panes: Iterable<ManagedPaneInternal>): void {
  const retainLiveContexts = shouldRetainSuspendedWebglContexts()
  for (const pane of panes) {
    pane.webglAttachmentDeferred = true
    if (!retainLiveContexts) {
      disposeWebgl(pane)
      continue
    }
    const evicted = retainSuspendedWebglPane(pane)
    if (evicted) {
      disposeWebgl(evicted)
    }
  }
}

export function resumePaneRendering(panes: Iterable<ManagedPaneInternal>): void {
  // Why: resume (worktree foreground, window wake) is the WebGL retry
  // boundary — Chromium may have restored the GPU process since a context
  // loss, and bounding retries to resume events cannot loop on live loss.
  clearTerminalWebglAttachBackoff()
  for (const pane of panes) {
    releaseRetainedWebglPane(pane)
    const wasDeferred = pane.webglAttachmentDeferred
    pane.webglAttachmentDeferred = false
    pane.webglDisabledAfterContextLoss = false
    if (wasDeferred && pane.webglAddon) {
      // Shared-atlas recovery skips deferred panes, so repaint the retained model now.
      try {
        if (pane.terminal.rows > 0) {
          pane.terminal.refresh(0, pane.terminal.rows - 1)
        }
      } catch {
        /* ignore — pane may be tearing down during resume */
      }
      continue
    }
    reattachWebglIfNeeded(pane)
  }
}

export function resetPaneWebglTextureAtlases(panes: Iterable<ManagedPaneInternal>): void {
  for (const pane of panes) {
    resetWebglTextureAtlas(pane)
  }
}
