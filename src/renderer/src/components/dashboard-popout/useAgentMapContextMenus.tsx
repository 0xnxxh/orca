import { useCallback, useRef, useState } from 'react'
import type { AgentMapProjectRing, AgentMapWorktreeRing } from './agent-map-layout'
import {
  AgentMapProjectContextMenuLoader,
  type AgentMapProjectContextMenuRequest
} from './AgentMapProjectContextMenuLoader'
import {
  AgentMapWorkspaceContextMenuLoader,
  type AgentMapWorkspaceContextMenuRequest
} from './AgentMapWorkspaceContextMenuLoader'

type UseAgentMapContextMenusArgs = {
  enabled: boolean
  onOpenChange?: (open: boolean) => void
}

export function useAgentMapContextMenus({ enabled, onOpenChange }: UseAgentMapContextMenusArgs): {
  contextMenus: React.JSX.Element | null
  onOpenProjectContextMenu?: (
    event: React.MouseEvent<SVGCircleElement>,
    project: AgentMapProjectRing
  ) => void
  onOpenWorkspaceContextMenu?: (
    event: React.MouseEvent<SVGCircleElement>,
    worktree: AgentMapWorktreeRing
  ) => void
} {
  const requestIdRef = useRef(0)
  const [workspaceRequest, setWorkspaceRequest] =
    useState<AgentMapWorkspaceContextMenuRequest | null>(null)
  const [projectRequest, setProjectRequest] = useState<AgentMapProjectContextMenuRequest | null>(
    null
  )
  const openWorkspaceContextMenu = useCallback(
    (event: React.MouseEvent<SVGCircleElement>, worktree: AgentMapWorktreeRing): void => {
      requestIdRef.current += 1
      setProjectRequest(null)
      setWorkspaceRequest({
        id: requestIdRef.current,
        worktreeId: worktree.worktreeId,
        executionHostId: worktree.executionHostId,
        clientX: event.clientX,
        clientY: event.clientY,
        altKey: event.altKey
      })
    },
    []
  )
  const openProjectContextMenu = useCallback(
    (event: React.MouseEvent<SVGCircleElement>, project: AgentMapProjectRing): void => {
      requestIdRef.current += 1
      setWorkspaceRequest(null)
      setProjectRequest({
        id: requestIdRef.current,
        projectId: project.id,
        clientX: event.clientX,
        clientY: event.clientY
      })
    },
    []
  )
  const handleWorkspaceLifecycleComplete = useCallback((): void => {
    setWorkspaceRequest(null)
  }, [])
  const handleProjectOpenChange = useCallback(
    (open: boolean): void => {
      onOpenChange?.(open)
      if (!open) {
        setProjectRequest(null)
      }
    },
    [onOpenChange]
  )
  const contextMenus = enabled ? (
    <>
      {workspaceRequest ? (
        <AgentMapWorkspaceContextMenuLoader
          request={workspaceRequest}
          onOpenChange={onOpenChange}
          onLifecycleComplete={handleWorkspaceLifecycleComplete}
        />
      ) : null}
      {projectRequest ? (
        <AgentMapProjectContextMenuLoader
          request={projectRequest}
          onOpenChange={handleProjectOpenChange}
        />
      ) : null}
    </>
  ) : null

  return {
    contextMenus,
    onOpenProjectContextMenu: enabled ? openProjectContextMenu : undefined,
    onOpenWorkspaceContextMenu: enabled ? openWorkspaceContextMenu : undefined
  }
}
