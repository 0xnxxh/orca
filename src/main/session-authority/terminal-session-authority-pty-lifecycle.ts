import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthoritySemanticFact
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import {
  findTerminalAuthorityPane,
  sameTerminalAuthorityBinding,
  terminalAuthorityLocatorForWorktreeId
} from './terminal-session-authority-spawn-state'
import { terminalAuthorityNamespaceLocatorKey } from '../../shared/terminal-session-authority-locator'
import type {
  TerminalPaneGeneration,
  TerminalSessionBinding
} from '../../shared/terminal-session-authority-identity'
import {
  classifyTerminalAuthorityMissingPty,
  parseTerminalAuthorityReattachIdentity,
  type TerminalAuthorityMissingPtyState
} from './terminal-session-authority-reattach-state'
import type {
  TerminalAuthorityAdoptedPtySpawn,
  TerminalAuthorityManagedPty,
  TerminalAuthorityPreparedPtySpawn
} from './terminal-session-authority-pty-binding'
import {
  terminalAuthorityLifecycleIdentityOperationId,
  terminalAuthorityLifecycleOperationId
} from './terminal-session-authority-lifecycle-operation'
import { TerminalSessionAuthorityPtyMutationCoordinator } from './terminal-session-authority-pty-mutation-coordinator'
import { TerminalSessionAuthorityPtySpawnLifecycle } from './terminal-session-authority-pty-spawn-lifecycle'
import type {
  TerminalAuthorityPolicyConsumerConnection,
  TerminalAuthorityPolicyConsumerSource
} from './terminal-session-authority-policy-consumers'
import { TerminalSessionAuthorityPtyConsumerBoundary } from './terminal-session-authority-pty-consumer-boundary'

export type {
  TerminalAuthorityAdoptedPtySpawn,
  TerminalAuthorityManagedPty,
  TerminalAuthorityPreparedPtySpawn
} from './terminal-session-authority-pty-binding'

export class TerminalSessionAuthorityPtyLifecycle extends TerminalSessionAuthorityPtyConsumerBoundary {
  private readonly mutations: TerminalSessionAuthorityPtyMutationCoordinator
  private readonly spawns: TerminalSessionAuthorityPtySpawnLifecycle

  constructor(
    private readonly registry: TerminalSessionAuthorityRegistry,
    private readonly ownerIncarnationId: string
  ) {
    super(registry, ownerIncarnationId)
    this.mutations = new TerminalSessionAuthorityPtyMutationCoordinator(
      registry,
      this.hostEffectConsumer
    )
    this.spawns = new TerminalSessionAuthorityPtySpawnLifecycle(this.mutations, ownerIncarnationId)
  }

  prepareSpawn(
    params: Record<string, unknown>,
    physicalPtyId: string,
    policyConsumer: TerminalAuthorityPolicyConsumerSource,
    operationId?: string
  ): Promise<TerminalAuthorityPreparedPtySpawn | TerminalAuthorityAdoptedPtySpawn> {
    return this.spawns.prepare(params, physicalPtyId, policyConsumer, operationId)
  }

  commitSpawn(
    prepared: TerminalAuthorityPreparedPtySpawn,
    ptyIncarnationId: string
  ): Promise<TerminalAuthorityManagedPty> {
    return this.spawns.commit(prepared, ptyIncarnationId)
  }

  cancelSpawn(prepared: TerminalAuthorityPreparedPtySpawn): Promise<void> {
    return this.spawns.cancel(prepared)
  }

  async closePty(
    managed: TerminalAuthorityManagedPty,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    operationId?: string
  ): Promise<void> {
    const rootOperationId =
      operationId ??
      terminalAuthorityLifecycleIdentityOperationId('close', [
        managed.pane.paneKey,
        managed.pane.paneGenerationId,
        managed.binding.ownerIncarnationId,
        managed.binding.physicalPtyId,
        managed.binding.ptyIncarnationId
      ])
    await this.mutations.enqueue(managed.runtime, async () => {
      const pane = findTerminalAuthorityPane(
        await this.mutations.projection(managed.runtime),
        managed.pane
      )
      if (!pane || pane.status === 'closed' || pane.status === 'exited') {
        return
      }
      if (!sameTerminalAuthorityBinding(pane.binding, managed.binding)) {
        failTerminalSessionAuthority('expectation-mismatch', 'pane binding changed before close')
      }
      await this.mutations.mutateForPolicy(
        managed.runtime,
        policyConsumer,
        {
          kind: 'close',
          pane: managed.pane,
          expected: { paneGenerationId: managed.pane.paneGenerationId, binding: managed.binding }
        },
        terminalAuthorityLifecycleOperationId(rootOperationId, 'close')
      )
    })
  }

  async closeExactPtyAccess(
    access: TerminalSessionAuthorityPtyAccess,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    operationId?: string
  ): Promise<void> {
    const locator = this.registry.locatorForNamespace(access.namespace)
    const existing = locator
      ? this.mutations.find(terminalAuthorityNamespaceLocatorKey(locator), locator)
      : null
    if (!existing) {
      failTerminalSessionAuthority('expectation-mismatch', 'exact PTY namespace is unavailable')
    }
    await this.closePty(
      Object.freeze({ runtime: await existing, pane: access.pane, binding: access.binding }),
      policyConsumer,
      operationId
    )
  }

  async recordExit(managed: TerminalAuthorityManagedPty, code: number | null): Promise<void> {
    await this.mutations.enqueue(managed.runtime, async () => {
      const pane = findTerminalAuthorityPane(
        await this.mutations.projection(managed.runtime),
        managed.pane
      )
      if (!pane || pane.status === 'superseded' || pane.status === 'exited') {
        return
      }
      const retiredByClose = pane.status === 'closed'
      const binding = retiredByClose ? pane.lastBinding : pane.binding
      if (!sameTerminalAuthorityBinding(binding, managed.binding)) {
        failTerminalSessionAuthority('expectation-mismatch', 'pane binding changed before exit')
      }
      await this.mutations.mutateHost(
        managed.runtime,
        {
          kind: 'exit',
          pane: managed.pane,
          expected: { paneGenerationId: managed.pane.paneGenerationId, binding: managed.binding },
          exit: { code, signal: null, ...(retiredByClose ? { retiredByClose: true as const } : {}) }
        },
        exitOperationId(managed.binding, code)
      )
    })
  }

  /** The append settles at durability; the independent delivery pump publishes later. */
  async recordSemanticFact(
    managed: TerminalAuthorityManagedPty,
    access: TerminalSessionAuthorityPtyAccess,
    producerSequence: number,
    fact: TerminalSessionAuthoritySemanticFact
  ): Promise<void> {
    await this.mutations.enqueue(managed.runtime, async () => {
      await this.mutations.recordSemanticOutcome(
        managed.runtime,
        access,
        this.ownerIncarnationId,
        producerSequence,
        fact
      )
    })
  }

  async recordImportedExit(
    input: Readonly<{
      worktreeId: string
      pane: TerminalPaneGeneration
      binding: TerminalSessionBinding
    }>,
    code: number
  ): Promise<void> {
    if (input.binding.ownerIncarnationId === this.ownerIncarnationId) {
      failTerminalSessionAuthority('writer-fenced', 'current-owner exit used imported routing')
    }
    const locator = terminalAuthorityLocatorForWorktreeId(input.worktreeId)
    const existing = this.mutations.find(terminalAuthorityNamespaceLocatorKey(locator), locator)
    if (!existing) {
      failTerminalSessionAuthority('record-corrupt', 'imported PTY namespace is unavailable')
    }
    const runtime = await existing
    await this.mutations.enqueue(runtime, async () => {
      const pane = findTerminalAuthorityPane(await this.mutations.projection(runtime), input.pane)
      if (!pane || pane.status === 'superseded' || pane.status === 'exited') {
        return
      }
      const retiredByClose = pane.status === 'closed'
      const binding = retiredByClose ? pane.lastBinding : pane.binding
      if (!sameTerminalAuthorityBinding(binding, input.binding)) {
        failTerminalSessionAuthority('expectation-mismatch', 'imported PTY binding changed')
      }
      await this.mutations.mutateHost(
        runtime,
        {
          kind: 'exit',
          pane: input.pane,
          expected: { paneGenerationId: input.pane.paneGenerationId, binding: input.binding },
          exit: { code, signal: null, ...(retiredByClose ? { retiredByClose: true as const } : {}) }
        },
        exitOperationId(input.binding, code)
      )
    })
  }

  async missingPtyState(
    params: Record<string, unknown>,
    physicalPtyId: string
  ): Promise<TerminalAuthorityMissingPtyState> {
    let identity
    try {
      identity = parseTerminalAuthorityReattachIdentity(params, physicalPtyId)
    } catch {
      return Object.freeze({ kind: 'unknown' })
    }
    if (!identity) {
      return Object.freeze({ kind: 'unknown' })
    }
    const existing = this.mutations.find(identity.locatorKey, identity.locator)
    if (!existing) {
      return Object.freeze({ kind: 'unknown' })
    }
    const runtime = await existing
    return this.mutations.enqueue(runtime, async () =>
      classifyTerminalAuthorityMissingPty(
        await this.mutations.projection(runtime),
        identity,
        this.ownerIncarnationId
      )
    )
  }

  bindingIsReachable(managed: TerminalAuthorityManagedPty): boolean {
    return (
      managed.runtime.service.bindingAuthority(
        managed.runtime.service.writerAccess,
        managed.pane,
        managed.binding
      ) === 'reachable'
    )
  }

  managedFromAdoption(adopted: TerminalAuthorityAdoptedPtySpawn): TerminalAuthorityManagedPty {
    return Object.freeze({
      runtime: adopted.runtime,
      pane: adopted.pane,
      binding: adopted.binding
    })
  }
}

function exitOperationId(binding: TerminalSessionBinding, code: number | null): string {
  return terminalAuthorityLifecycleIdentityOperationId('exit', [
    binding.ownerIncarnationId,
    binding.physicalPtyId,
    binding.ptyIncarnationId,
    code === null ? 'null' : String(code)
  ])
}
