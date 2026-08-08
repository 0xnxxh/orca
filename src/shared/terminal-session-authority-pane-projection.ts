import type {
  TerminalPaneAuthorityProjection,
  TerminalPaneAuthorityRecord,
  TerminalSessionPtyAllocation
} from './terminal-session-authority-mutation'
import type { TerminalSessionBinding } from './terminal-session-authority-identity'

export function projectTerminalAuthorityPanes(
  panes: readonly TerminalPaneAuthorityRecord[],
  ownerIsReachable: (ownerIncarnationId: string) => boolean
): readonly TerminalPaneAuthorityProjection[] {
  return Object.freeze(
    panes.map((pane) =>
      Object.freeze({
        ...pane,
        binding: cloneBinding(pane.binding),
        lastBinding: cloneBinding(pane.lastBinding),
        ownerStatus: pane.binding
          ? ownerIsReachable(pane.binding.ownerIncarnationId)
            ? ('reachable' as const)
            : ('owner-unreachable' as const)
          : null
      })
    )
  )
}

export function projectTerminalAuthorityAllocations(
  allocations: readonly TerminalSessionPtyAllocation[]
): readonly TerminalSessionPtyAllocation[] {
  return Object.freeze(
    allocations.map(
      (allocation): TerminalSessionPtyAllocation =>
        allocation.status === 'pending'
          ? Object.freeze({
              ...allocation,
              pane: Object.freeze({ ...allocation.pane })
            })
          : Object.freeze({
              ...allocation,
              pane: Object.freeze({ ...allocation.pane }),
              binding: Object.freeze({ ...allocation.binding })
            })
    )
  )
}

function cloneBinding(binding: TerminalSessionBinding | null): TerminalSessionBinding | null {
  return binding ? Object.freeze({ ...binding }) : null
}
