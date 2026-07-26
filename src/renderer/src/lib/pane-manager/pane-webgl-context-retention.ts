import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { ManagedPaneInternal } from './pane-manager-types'

// Leaves 96 of Electron's 128 contexts for visible panes and new attachments.
export const RETAINED_WEBGL_PANE_LIMIT = 32

export function shouldRetainSuspendedWebglContexts(): boolean {
  return (
    typeof window !== 'undefined' && getRendererAppPlatform() === 'win32' && !isWebClientLocation()
  )
}

// Set insertion order is the hidden-pane recency order.
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
