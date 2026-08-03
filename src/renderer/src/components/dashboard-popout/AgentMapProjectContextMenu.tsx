import { useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useAppStore } from '@/store'
import { useRepoById } from '@/store/selectors'
import { getRepoHeaderCreateState } from '@/components/sidebar/repo-header-create-state'

export type AgentMapProjectContextMenuRequest = {
  id: number
  projectId: string
  clientX: number
  clientY: number
}

type AgentMapProjectContextMenuProps = {
  request: AgentMapProjectContextMenuRequest
  onOpenChange?: (open: boolean) => void
}

export function AgentMapProjectContextMenu({
  request,
  onOpenChange
}: AgentMapProjectContextMenuProps): React.JSX.Element | null {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const repo = useRepoById(request.projectId)
  const sshStatus = useAppStore((state) =>
    repo?.connectionId ? (state.sshConnectionStates.get(repo.connectionId)?.status ?? null) : null
  )
  const openModal = useAppStore((state) => state.openModal)

  useEffect(() => {
    triggerRef.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: request.clientX,
        clientY: request.clientY,
        button: 2
      })
    )
  }, [request])

  if (!repo) {
    return null
  }
  const createState = getRepoHeaderCreateState({
    repo,
    label: repo.displayName,
    sshStatus
  })

  return (
    <div className="pointer-events-none absolute inset-0">
      <ContextMenu onOpenChange={onOpenChange}>
        <ContextMenuTrigger asChild>
          <span ref={triggerRef} aria-hidden />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{repo.displayName}</ContextMenuLabel>
          <ContextMenuItem
            disabled={createState.disabled}
            aria-label={createState.ariaLabel}
            onSelect={() => {
              openModal('new-workspace-composer', {
                initialRepoId: repo.id,
                telemetrySource: 'sidebar'
              })
            }}
          >
            <Plus />
            {createState.tooltip}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}
