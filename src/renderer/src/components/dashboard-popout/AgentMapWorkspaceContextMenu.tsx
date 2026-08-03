import { Suspense, useEffect, useRef } from 'react'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { useWorktreeById } from '@/store/selectors'
import type { ExecutionHostId } from '../../../../shared/execution-host'

const WorktreeContextMenu = lazyWithRetry(
  () => import('@/components/sidebar/WorktreeContextMenu'),
  { reloadKey: 'agent-map-worktree-context-menu' }
)

export type AgentMapWorkspaceContextMenuRequest = {
  id: number
  worktreeId: string
  executionHostId?: ExecutionHostId
  clientX: number
  clientY: number
  altKey: boolean
}

type AgentMapWorkspaceContextMenuProps = {
  request: AgentMapWorkspaceContextMenuRequest | null
  onOpenChange?: (open: boolean) => void
}

function ContextMenuTrigger({
  request
}: {
  request: AgentMapWorkspaceContextMenuRequest
}): React.JSX.Element {
  const triggerRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    triggerRef.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: request.clientX,
        clientY: request.clientY,
        altKey: request.altKey,
        button: 2
      })
    )
  }, [request])
  return <span ref={triggerRef} aria-hidden />
}

export function AgentMapWorkspaceContextMenu({
  request,
  onOpenChange
}: AgentMapWorkspaceContextMenuProps): React.JSX.Element | null {
  const worktree = useWorktreeById(request?.worktreeId ?? null, request?.executionHostId)
  if (!request || !worktree) {
    return null
  }
  return (
    <div className="pointer-events-none absolute inset-0">
      <Suspense fallback={null}>
        <WorktreeContextMenu worktree={worktree} onOpenChange={onOpenChange}>
          <ContextMenuTrigger request={request} />
        </WorktreeContextMenu>
      </Suspense>
    </div>
  )
}
