import {
  sameTerminalBinding,
  terminalPaneGenerationKey,
  terminalPtyIncarnationKey,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalBindingAuthority,
  type TerminalPaneAuthorityProjection,
  type TerminalPaneAuthorityRecord,
  type TerminalSessionAuthorityMutationResult,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from './terminal-session-authority-mutation'
import {
  terminalAuthorityOperationKey,
  terminalAuthorityPhysicalPtyKey
} from './terminal-session-authority-transition'
import type { TerminalLegacyImportedRecovery } from './terminal-legacy-cutover'
import { planTerminalAuthorityLegacyTopologyImport } from './terminal-session-authority-legacy-topology-import'
import {
  projectTerminalAuthorityAllocations,
  projectTerminalAuthorityPanes
} from './terminal-session-authority-pane-projection'
import { TerminalAuthorityPaneBindingIndex } from './terminal-session-authority-pane-binding-index'
import {
  reclaimSupersededTerminalAuthorityPanes,
  sortTerminalAuthorityPanes
} from './terminal-session-authority-pane-history'
import {
  assertRestorableTerminalAuthorityAllocation,
  assertRestorableTerminalAuthorityPane
} from './terminal-session-authority-restore-validation'

export class TerminalSessionAuthorityTopology {
  private readonly panes = new Map<string, TerminalPaneAuthorityRecord>()
  private readonly latestPaneByKey = new Map<string, TerminalPaneAuthorityRecord>()
  private readonly openPanes = new Map<string, string>()
  private readonly paneBindings = new TerminalAuthorityPaneBindingIndex()
  private readonly allocations = new Map<string, TerminalSessionPtyAllocation>()
  private readonly allocationByPane = new Map<string, string>()
  private readonly allocationByPhysicalPty = new Map<string, string>()
  private readonly allocationByBinding = new Map<string, string>()
  private readonly allocationByIntent = new Map<string, string>()
  private pendingAllocationsValue = 0

  constructor(
    readonly ownerIncarnationId: string,
    private readonly maxPendingAllocations: number,
    private readonly maxPaneRecords: number,
    private readonly ownerIsReachable: (ownerIncarnationId: string) => boolean
  ) {}

  get pendingAllocationCapacityReached(): boolean {
    return this.pendingAllocationsValue >= this.maxPendingAllocations
  }

  get paneCapacityReached(): boolean {
    return this.latestPaneByKey.size >= this.maxPaneRecords
  }

  pane(generation: TerminalPaneGeneration): TerminalPaneAuthorityRecord | null {
    return this.panes.get(terminalPaneGenerationKey(generation)) ?? null
  }

  openPaneGenerationId(paneKey: string): string | null {
    return this.openPanes.get(paneKey) ?? null
  }

  latestPaneGenerationId(paneKey: string): string | null {
    return this.latestPaneByKey.get(paneKey)?.paneGenerationId ?? null
  }

  allocation(allocationId: string): TerminalSessionPtyAllocation | null {
    return this.allocations.get(allocationId) ?? null
  }

  paneAllocation(pane: TerminalPaneGeneration): TerminalSessionPtyAllocation | null {
    const allocationId = this.allocationByPane.get(terminalPaneGenerationKey(pane))
    return allocationId ? (this.allocations.get(allocationId) ?? null) : null
  }

  allocationConflict(allocation: TerminalSessionPtyAllocationIdentity): boolean {
    return (
      this.allocationByPane.has(terminalPaneGenerationKey(allocation.pane)) ||
      this.allocationByPhysicalPty.has(
        terminalAuthorityPhysicalPtyKey(allocation.ownerIncarnationId, allocation.physicalPtyId)
      )
    )
  }

  hasIntent(actorId: string, operationId: string): boolean {
    return this.allocationByIntent.has(terminalAuthorityOperationKey(actorId, operationId))
  }

  ptyOwner(binding: TerminalSessionBinding): string | null {
    return this.paneBindings.ptyOwner(binding)
  }

  ownerHasBinding(ownerIncarnationId: string): boolean {
    return this.paneBindings.ownerHasBinding(ownerIncarnationId)
  }

  apply(result: TerminalSessionAuthorityMutationResult): void {
    this.setPane(result.pane)
    if (result.replacementPane) {
      this.setPane(result.replacementPane)
    }
    if (result.kind === 'supersede' && result.replacementPane) {
      this.panes.delete(terminalPaneGenerationKey(result.pane))
    }
    if (result.kind === 'prepare-allocation' || result.kind === 'commit-allocation') {
      if (!result.allocation) {
        failTerminalSessionAuthority('record-corrupt', 'allocation result is missing')
      }
      this.replaceAllocation(result.allocation)
      return
    }
    if (result.kind === 'cancel-allocation') {
      const allocationId = this.allocationByPane.get(terminalPaneGenerationKey(result.pane))
      if (allocationId) {
        this.deleteAllocation(allocationId)
      }
      return
    }
    for (const effect of result.effects) {
      if (effect.kind !== 'binding-retired') {
        continue
      }
      const allocationId = this.allocationByBinding.get(terminalPtyIncarnationKey(effect.binding))
      if (allocationId) {
        this.deleteAllocation(allocationId)
      }
    }
  }

  restore(
    panes: readonly TerminalPaneAuthorityRecord[],
    allocations: readonly TerminalSessionPtyAllocation[],
    revision: number
  ): void {
    for (const pane of panes) {
      this.restorePane(pane, revision)
    }
    reclaimSupersededTerminalAuthorityPanes(this.panes, this.latestPaneByKey)
    if (this.latestPaneByKey.size > this.maxPaneRecords) {
      failTerminalSessionAuthority('capacity', 'snapshot exceeds pane retention capacity')
    }
    for (const allocation of allocations) {
      this.restoreAllocation(allocation, revision)
    }
    for (const pane of this.panes.values()) {
      if (!pane.binding) {
        continue
      }
      const allocationId = this.allocationByBinding.get(terminalPtyIncarnationKey(pane.binding))
      if (this.allocations.get(allocationId ?? '')?.status !== 'committed') {
        failTerminalSessionAuthority('record-corrupt', 'live binding has no spawn receipt')
      }
    }
  }

  importLegacyRows(
    rows: readonly TerminalLegacyImportedRecovery[],
    receiptId: string,
    revision: number
  ): void {
    const planned = this.planLegacyImport(rows, receiptId, revision)
    planned.panes.forEach((pane) => this.setPane(pane))
    planned.allocations.forEach((allocation) => this.replaceAllocation(allocation))
  }

  planLegacyImport(
    rows: readonly TerminalLegacyImportedRecovery[],
    receiptId: string,
    revision: number
  ): ReturnType<typeof planTerminalAuthorityLegacyTopologyImport> {
    const planned = planTerminalAuthorityLegacyTopologyImport(rows, receiptId, revision, {
      paneGenerations: this.panes,
      paneKeys: this.latestPaneByKey,
      allocationIds: this.allocations,
      physicalPtys: this.allocationByPhysicalPty,
      maxPaneRecords: this.maxPaneRecords
    })
    return planned
  }

  projectedPanes(): readonly TerminalPaneAuthorityProjection[] {
    return projectTerminalAuthorityPanes(
      sortTerminalAuthorityPanes(this.panes.values()),
      this.ownerIsReachable
    )
  }

  bindingAuthority(
    pane: TerminalPaneGeneration,
    binding: TerminalSessionBinding
  ): TerminalBindingAuthority {
    const record = this.pane(pane)
    if (!record) {
      return 'absent'
    }
    if (!record.binding) {
      if (!sameTerminalBinding(record.lastBinding, binding)) {
        return 'absent'
      }
      if (record.status === 'closed') {
        return 'closed'
      }
      return record.status === 'exited' ? 'exited' : 'absent'
    }
    if (!sameTerminalBinding(record.binding, binding)) {
      return 'binding-mismatch'
    }
    return this.ownerIsReachable(binding.ownerIncarnationId) ? 'reachable' : 'owner-unreachable'
  }

  paneSnapshot(): readonly TerminalPaneAuthorityRecord[] {
    return Object.freeze(sortTerminalAuthorityPanes(this.panes.values()))
  }

  allocationSnapshot(): readonly TerminalSessionPtyAllocation[] {
    return projectTerminalAuthorityAllocations(
      [...this.allocations.values()].sort((left, right) =>
        left.allocationId.localeCompare(right.allocationId)
      )
    )
  }

  private setPane(pane: TerminalPaneAuthorityRecord): void {
    const paneGenerationKey = terminalPaneGenerationKey(pane)
    const previous = this.panes.get(paneGenerationKey)
    this.paneBindings.replace(previous?.binding ?? null, pane.binding, paneGenerationKey)
    this.panes.set(paneGenerationKey, pane)
    const latest = this.latestPaneByKey.get(pane.paneKey)
    if (
      !latest ||
      pane.revision > latest.revision ||
      (pane.revision === latest.revision &&
        latest.status === 'superseded' &&
        pane.status !== 'superseded')
    ) {
      this.latestPaneByKey.set(pane.paneKey, pane)
    }
    if (pane.status === 'open') {
      this.openPanes.set(pane.paneKey, pane.paneGenerationId)
    } else if (this.openPanes.get(pane.paneKey) === pane.paneGenerationId) {
      this.openPanes.delete(pane.paneKey)
    }
  }

  private replaceAllocation(allocation: TerminalSessionPtyAllocation): void {
    this.deleteAllocation(allocation.allocationId)
    this.allocations.set(allocation.allocationId, allocation)
    this.allocationByPane.set(terminalPaneGenerationKey(allocation.pane), allocation.allocationId)
    this.allocationByPhysicalPty.set(
      terminalAuthorityPhysicalPtyKey(allocation.ownerIncarnationId, allocation.physicalPtyId),
      allocation.allocationId
    )
    this.allocationByIntent.set(
      terminalAuthorityOperationKey(allocation.intentActorId, allocation.intentOperationId),
      allocation.allocationId
    )
    if (allocation.status === 'pending') {
      this.pendingAllocationsValue += 1
    } else {
      this.allocationByBinding.set(
        terminalPtyIncarnationKey(allocation.binding),
        allocation.allocationId
      )
    }
  }

  private deleteAllocation(allocationId: string): void {
    const allocation = this.allocations.get(allocationId)
    if (!allocation) {
      return
    }
    this.allocations.delete(allocationId)
    this.allocationByPane.delete(terminalPaneGenerationKey(allocation.pane))
    const physicalKey = terminalAuthorityPhysicalPtyKey(
      allocation.ownerIncarnationId,
      allocation.physicalPtyId
    )
    this.allocationByPhysicalPty.delete(physicalKey)
    this.allocationByIntent.delete(
      terminalAuthorityOperationKey(allocation.intentActorId, allocation.intentOperationId)
    )
    if (allocation.status === 'pending') {
      this.pendingAllocationsValue -= 1
    } else {
      this.allocationByBinding.delete(terminalPtyIncarnationKey(allocation.binding))
    }
  }

  private restorePane(pane: TerminalPaneAuthorityRecord, revision: number): void {
    assertRestorableTerminalAuthorityPane(pane, revision, this)
    this.setPane(Object.freeze(pane))
  }

  private restoreAllocation(allocation: TerminalSessionPtyAllocation, revision: number): void {
    assertRestorableTerminalAuthorityAllocation(allocation, revision, this)
    this.replaceAllocation(Object.freeze(allocation))
    if (this.pendingAllocationsValue > this.maxPendingAllocations) {
      failTerminalSessionAuthority('capacity', 'snapshot exceeds pending allocation capacity')
    }
  }
}
