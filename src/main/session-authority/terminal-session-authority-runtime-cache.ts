import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityProjection } from '../../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityNamespaceLocator } from '../../shared/terminal-session-authority-locator'
import type { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import type { TerminalSessionAuthorityHostEffectConsumer } from './terminal-session-authority-host-effect-consumer'
import type { TerminalAuthorityPolicyConsumerConnection } from './terminal-session-authority-policy-consumers'

export type TerminalAuthorityNamespaceRuntime = {
  service: TerminalSessionAuthorityService
  queue: Promise<void>
}

export class TerminalSessionAuthorityRuntimeCache {
  private readonly runtimes = new Map<string, Promise<TerminalAuthorityNamespaceRuntime>>()

  constructor(
    private readonly registry: TerminalSessionAuthorityRegistry,
    private readonly hostEffects: TerminalSessionAuthorityHostEffectConsumer
  ) {}

  async resolve(
    _locatorKey: string,
    locator: TerminalAuthorityNamespaceLocator
  ): Promise<TerminalAuthorityNamespaceRuntime> {
    const registered = this.registry.namespaceForLocator(locator)
    if (registered) {
      return this.open(registered)
    }
    const resolved = await this.registry.resolveNamespace(locator)
    return this.open(resolved.namespace)
  }

  find(
    _locatorKey: string,
    locator: TerminalAuthorityNamespaceLocator
  ): Promise<TerminalAuthorityNamespaceRuntime> | null {
    const namespace = this.registry.namespaceForLocator(locator)
    return namespace ? this.open(namespace) : null
  }

  enqueue<T>(runtime: TerminalAuthorityNamespaceRuntime, operation: () => Promise<T>): Promise<T> {
    const result = runtime.queue.then(operation)
    runtime.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async projection(
    runtime: TerminalAuthorityNamespaceRuntime
  ): Promise<TerminalAuthorityProjection> {
    return runtime.service.snapshotForWriter(runtime.service.writerAccess)
  }

  async admitPolicyConsumer(
    runtime: TerminalAuthorityNamespaceRuntime,
    connection: TerminalAuthorityPolicyConsumerConnection
  ): Promise<void> {
    await connection.ensureNamespace(runtime.service)
    connection.assertInstalled(runtime.service.namespace)
  }

  assertPolicyConsumer(
    runtime: TerminalAuthorityNamespaceRuntime,
    connection: TerminalAuthorityPolicyConsumerConnection
  ): void {
    connection.assertInstalled(runtime.service.namespace)
  }

  private open(namespace: TerminalAuthorityNamespace): Promise<TerminalAuthorityNamespaceRuntime> {
    const key = namespaceKey(namespace)
    const existing = this.runtimes.get(key)
    if (existing) {
      return existing
    }
    const opening = this.openRuntime(namespace)
    this.runtimes.set(key, opening)
    void opening.catch(() => this.runtimes.delete(key))
    return opening
  }

  private async openRuntime(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalAuthorityNamespaceRuntime> {
    const service = await this.registry.openNamespace(namespace)
    await this.hostEffects.ensure(service)
    this.hostEffects.assertApplierInstalled()
    const runtime: TerminalAuthorityNamespaceRuntime = {
      service,
      queue: Promise.resolve()
    }
    return runtime
  }
}

function namespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}
