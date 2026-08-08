import type {
  TerminalAuthorityProjection,
  TerminalSessionAuthorityChange,
  TerminalSessionAuthoritySemanticFact
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalAuthorityNamespaceLocator } from '../../shared/terminal-session-authority-locator'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import {
  TerminalSessionAuthorityRuntimeCache,
  type TerminalAuthorityNamespaceRuntime
} from './terminal-session-authority-runtime-cache'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import type { TerminalSessionAuthorityHostEffectConsumer } from './terminal-session-authority-host-effect-consumer'
import type { TerminalAuthorityPolicyConsumerConnection } from './terminal-session-authority-policy-consumers'

export class TerminalSessionAuthorityPtyMutationCoordinator {
  private readonly runtimeCache: TerminalSessionAuthorityRuntimeCache

  constructor(
    registry: TerminalSessionAuthorityRegistry,
    hostEffects: TerminalSessionAuthorityHostEffectConsumer
  ) {
    this.runtimeCache = new TerminalSessionAuthorityRuntimeCache(registry, hostEffects)
  }

  resolve(
    locatorKey: string,
    locator: TerminalAuthorityNamespaceLocator
  ): Promise<TerminalAuthorityNamespaceRuntime> {
    return this.runtimeCache.resolve(locatorKey, locator)
  }

  find(
    locatorKey: string,
    locator: TerminalAuthorityNamespaceLocator
  ): Promise<TerminalAuthorityNamespaceRuntime> | null {
    return this.runtimeCache.find(locatorKey, locator)
  }

  enqueue<T>(runtime: TerminalAuthorityNamespaceRuntime, operation: () => Promise<T>): Promise<T> {
    return this.runtimeCache.enqueue(runtime, operation)
  }

  projection(runtime: TerminalAuthorityNamespaceRuntime): Promise<TerminalAuthorityProjection> {
    return this.runtimeCache.projection(runtime)
  }

  admitPolicyConsumer(
    runtime: TerminalAuthorityNamespaceRuntime,
    connection: TerminalAuthorityPolicyConsumerConnection
  ): Promise<void> {
    return this.runtimeCache.admitPolicyConsumer(runtime, connection)
  }

  recordSemanticOutcome(
    runtime: TerminalAuthorityNamespaceRuntime,
    access: TerminalSessionAuthorityPtyAccess,
    producerIncarnationId: string,
    producerSequence: number,
    fact: TerminalSessionAuthoritySemanticFact
  ) {
    return runtime.service.recordSemanticOutcome(runtime.service.writerAccess, {
      access,
      producerIncarnationId,
      producerSequence,
      fact
    })
  }

  async mutateForPolicy(
    runtime: TerminalAuthorityNamespaceRuntime,
    connection: TerminalAuthorityPolicyConsumerConnection,
    change: TerminalSessionAuthorityChange,
    correlationId: string
  ) {
    this.runtimeCache.assertPolicyConsumer(runtime, connection)
    return await this.mutateHost(runtime, change, correlationId)
  }

  async mutateHost(
    runtime: TerminalAuthorityNamespaceRuntime,
    change: TerminalSessionAuthorityChange,
    correlationId: string
  ) {
    const projection = await this.projection(runtime)
    const operationIdentity = terminalAuthorityOperationIdentity(projection.revision, correlationId)
    const receipt = await runtime.service.mutate(runtime.service.writerAccess, {
      actorId: runtime.service.writerAccess.actorId,
      ...operationIdentity,
      baseRevision: projection.revision,
      change
    })
    return receipt.result
  }
}
