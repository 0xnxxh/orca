import { Suspense } from 'react'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import type { AgentMapWorkspaceContextMenuRequest } from './AgentMapWorkspaceContextMenu'

const AgentMapWorkspaceContextMenu = lazyWithRetry(
  () =>
    import('./AgentMapWorkspaceContextMenu').then((module) => ({
      default: module.AgentMapWorkspaceContextMenu
    })),
  { reloadKey: 'agent-map-workspace-context-menu' }
)

type AgentMapWorkspaceContextMenuLoaderProps = {
  request: AgentMapWorkspaceContextMenuRequest
  onOpenChange?: (open: boolean) => void
}

export function AgentMapWorkspaceContextMenuLoader({
  request,
  onOpenChange
}: AgentMapWorkspaceContextMenuLoaderProps): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <AgentMapWorkspaceContextMenu request={request} onOpenChange={onOpenChange} />
    </Suspense>
  )
}

export type { AgentMapWorkspaceContextMenuRequest }
