import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import { isWebClientLocation } from '@/lib/web-client-location'
import { TERMINAL_WEBGL_RETAINED_WORKTREE_CONTEXTS } from '../../../../shared/terminal-webgl-context-budget'
import type { ManagedPaneInternal } from './pane-manager-types'

export const RETAINED_WEBGL_PANE_LIMIT = TERMINAL_WEBGL_RETAINED_WORKTREE_CONTEXTS

export function shouldRetainSuspendedWebglContexts(): boolean {
  return (
    typeof window !== 'undefined' && getRendererAppPlatform() === 'win32' && !isWebClientLocation()
  )
}

// Set insertion order tracks worktree-surface hide recency.
const retainedPanes = new Set<ManagedPaneInternal>()

export function retainSuspendedWebglPane(pane: ManagedPaneInternal): ManagedPaneInternal | null {
  if (!pane.webglAddon) {
    retainedPanes.delete(pane)
    return null
  }
  retainedPanes.delete(pane)
  retainedPanes.add(pane)
  if (retainedPanes.size <= RETAINED_WEBGL_PANE_LIMIT) {
    return null
  }
  const oldest = retainedPanes.values().next().value
  if (!oldest) {
    return null
  }
  retainedPanes.delete(oldest)
  return oldest
}

export function releaseRetainedWebglPane(pane: ManagedPaneInternal): void {
  retainedPanes.delete(pane)
}

export function retainedWebglPaneCount(): number {
  return retainedPanes.size
}

export function clearRetainedWebglPanesForTests(): void {
  retainedPanes.clear()
}
