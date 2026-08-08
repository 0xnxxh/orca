import {
  failTerminalSessionAuthority,
  type TerminalAuthorityProjection,
  type TerminalSessionPtyAllocation,
  type TerminalSessionPtyAllocationIdentity
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalPaneGeneration } from '../../shared/terminal-session-authority-identity'
import {
  exactTerminalAuthorityAllocation,
  findTerminalAuthorityPane,
  latestTerminalAuthorityPane,
  parseTerminalAuthoritySpawnIdentity
} from './terminal-session-authority-spawn-state'
import {
  terminalAuthorityLifecycleIdentityOperationId,
  terminalAuthorityLifecycleOperationId
} from './terminal-session-authority-lifecycle-operation'
import type {
  TerminalAuthorityAdoptedPtySpawn,
  TerminalAuthorityManagedPty,
  TerminalAuthorityPreparedPtySpawn
} from './terminal-session-authority-pty-binding'
import type { TerminalSessionAuthorityPtyMutationCoordinator } from './terminal-session-authority-pty-mutation-coordinator'
import type { TerminalAuthorityNamespaceRuntime } from './terminal-session-authority-runtime-cache'
import {
  terminalAuthorityPolicyConsumerForNamespace,
  type TerminalAuthorityPolicyConsumerConnection,
  type TerminalAuthorityPolicyConsumerSource
} from './terminal-session-authority-policy-consumers'

export class TerminalSessionAuthorityPtySpawnLifecycle {
  constructor(
    private readonly mutations: TerminalSessionAuthorityPtyMutationCoordinator,
    private readonly ownerIncarnationId: string
  ) {}

  async prepare(
    params: Record<string, unknown>,
    physicalPtyId: string,
    policyConsumerSource: TerminalAuthorityPolicyConsumerSource,
    operationId?: string
  ): Promise<TerminalAuthorityPreparedPtySpawn | TerminalAuthorityAdoptedPtySpawn> {
    const identity = parseTerminalAuthoritySpawnIdentity(params, this.ownerIncarnationId)
    const rootOperationId =
      operationId ??
      terminalAuthorityLifecycleIdentityOperationId('spawn', [
        physicalPtyId,
        identity.pane.paneKey,
        identity.pane.paneGenerationId,
        identity.spawnFingerprint
      ])
    const allocation = Object.freeze({
      allocationId: terminalAuthorityLifecycleOperationId(rootOperationId, 'allocation'),
      pane: identity.pane,
      ownerIncarnationId: this.ownerIncarnationId,
      physicalPtyId,
      spawnFingerprint: identity.spawnFingerprint
    })
    const runtime = await this.mutations.resolve(identity.locatorKey, identity.locator)
    const policyConsumer = terminalAuthorityPolicyConsumerForNamespace(
      policyConsumerSource,
      runtime.service.namespace
    )
    await this.mutations.admitPolicyConsumer(runtime, policyConsumer)
    return this.mutations.enqueue(runtime, async () => {
      const projection = await this.mutations.projection(runtime)
      const exact = findTerminalAuthorityPane(projection, identity.pane)
      if (exact?.binding) {
        const committed = exactTerminalAuthorityAllocation(projection, exact.binding)
        if (committed.spawnFingerprint !== identity.spawnFingerprint) {
          failTerminalSessionAuthority('operation-conflict', 'pane spawn parameters changed')
        }
        if (exact.ownerStatus !== 'reachable') {
          failTerminalSessionAuthority('writer-fenced', 'pane owner is unreachable')
        }
        return Object.freeze({
          kind: 'adopt' as const,
          runtime,
          policyConsumer,
          pane: identity.pane,
          binding: exact.binding
        })
      }
      if (exact && exact.status !== 'open') {
        failTerminalSessionAuthority('expectation-mismatch', 'pane generation is inactive')
      }
      const exactPending = projection.allocations.find(
        (candidate) =>
          candidate.pane.paneKey === identity.pane.paneKey &&
          candidate.pane.paneGenerationId === identity.pane.paneGenerationId
      )
      if (exactPending) {
        if (samePreparedAllocation(exactPending, allocation)) {
          return Object.freeze({
            kind: 'spawn' as const,
            operationId: rootOperationId,
            runtime,
            policyConsumer,
            pane: identity.pane,
            allocation
          })
        }
        this.rejectPendingConflict(exactPending.ownerIncarnationId, 'pane')
      }
      if (!exact) {
        await this.preparePaneGeneration(
          runtime,
          policyConsumer,
          projection,
          identity.pane,
          rootOperationId
        )
      }
      await this.mutations.mutateForPolicy(
        runtime,
        policyConsumer,
        {
          kind: 'prepare-allocation',
          allocation,
          expected: { paneGenerationId: identity.pane.paneGenerationId, binding: null }
        },
        terminalAuthorityLifecycleOperationId(rootOperationId, 'prepare')
      )
      return Object.freeze({
        kind: 'spawn' as const,
        operationId: rootOperationId,
        runtime,
        policyConsumer,
        pane: identity.pane,
        allocation
      })
    })
  }

  async commit(
    prepared: TerminalAuthorityPreparedPtySpawn,
    ptyIncarnationId: string
  ): Promise<TerminalAuthorityManagedPty> {
    return this.mutations.enqueue(prepared.runtime, async () => {
      const result = await this.mutations.mutateForPolicy(
        prepared.runtime,
        prepared.policyConsumer,
        {
          kind: 'commit-allocation',
          allocation: prepared.allocation,
          ptyIncarnationId,
          expected: { paneGenerationId: prepared.pane.paneGenerationId, binding: null }
        },
        terminalAuthorityLifecycleOperationId(prepared.operationId, 'commit')
      )
      if (!result.pane.binding) {
        failTerminalSessionAuthority('record-corrupt', 'committed pane has no exact binding')
      }
      return Object.freeze({
        runtime: prepared.runtime,
        pane: prepared.pane,
        binding: result.pane.binding
      })
    })
  }

  async cancel(prepared: TerminalAuthorityPreparedPtySpawn): Promise<void> {
    await this.mutations.enqueue(prepared.runtime, async () => {
      const projection = await this.mutations.projection(prepared.runtime)
      const allocation = projection.allocations.find(
        (candidate) => candidate.allocationId === prepared.allocation.allocationId
      )
      if (!allocation) {
        return
      }
      if (allocation.status !== 'pending') {
        failTerminalSessionAuthority('allocation-conflict', 'spawn allocation already committed')
      }
      await this.mutations.mutateHost(
        prepared.runtime,
        {
          kind: 'cancel-allocation',
          allocation: prepared.allocation,
          expected: { paneGenerationId: prepared.pane.paneGenerationId, binding: null }
        },
        terminalAuthorityLifecycleOperationId(prepared.operationId, 'cancel')
      )
    })
  }

  private async preparePaneGeneration(
    runtime: TerminalAuthorityNamespaceRuntime,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    projection: TerminalAuthorityProjection,
    pane: TerminalPaneGeneration,
    operationId: string
  ): Promise<void> {
    const latest = latestTerminalAuthorityPane(projection, pane.paneKey)
    if (!latest) {
      await this.mutations.mutateForPolicy(
        runtime,
        policyConsumer,
        { kind: 'create', pane },
        terminalAuthorityLifecycleOperationId(operationId, 'create')
      )
      return
    }
    const pending = projection.allocations.find(
      (allocation) =>
        allocation.status === 'pending' &&
        allocation.pane.paneKey === latest.paneKey &&
        allocation.pane.paneGenerationId === latest.paneGenerationId
    )
    if (pending) {
      this.rejectPendingConflict(pending.ownerIncarnationId, 'predecessor')
    }
    if (latest.binding && latest.ownerStatus === 'owner-unreachable') {
      failTerminalSessionAuthority('writer-fenced', 'predecessor pane owner is unreachable')
    }
    if (latest.status === 'closed' || latest.binding) {
      failTerminalSessionAuthority(
        'expectation-mismatch',
        'a different pane generation remains authoritative'
      )
    }
    await this.mutations.mutateForPolicy(
      runtime,
      policyConsumer,
      {
        kind: 'supersede',
        pane: { paneKey: latest.paneKey, paneGenerationId: latest.paneGenerationId },
        replacementPaneGenerationId: pane.paneGenerationId,
        expected: { paneGenerationId: latest.paneGenerationId, binding: latest.binding }
      },
      terminalAuthorityLifecycleOperationId(operationId, 'supersede')
    )
  }

  private rejectPendingConflict(ownerIncarnationId: string, subject: string): never {
    failTerminalSessionAuthority(
      ownerIncarnationId === this.ownerIncarnationId ? 'operation-conflict' : 'writer-fenced',
      ownerIncarnationId === this.ownerIncarnationId
        ? `${subject} spawn is already in progress`
        : `${subject} spawn ownership is unresolved`
    )
  }
}

function samePreparedAllocation(
  left: TerminalSessionPtyAllocation,
  right: TerminalSessionPtyAllocationIdentity
): boolean {
  return (
    left.status === 'pending' &&
    left.allocationId === right.allocationId &&
    left.pane.paneKey === right.pane.paneKey &&
    left.pane.paneGenerationId === right.pane.paneGenerationId &&
    left.ownerIncarnationId === right.ownerIncarnationId &&
    left.physicalPtyId === right.physicalPtyId &&
    left.spawnFingerprint === right.spawnFingerprint
  )
}
