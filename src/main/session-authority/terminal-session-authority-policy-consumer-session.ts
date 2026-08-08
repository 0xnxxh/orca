import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityNamespaceOutcomeAck,
  TerminalAuthorityPolicyConsumerIdentity
} from '../../shared/terminal-session-authority-consumer-transport'
import type { TerminalAuthorityConsumerAdmissionSeal } from './terminal-session-authority-consumer-admission-seal'
import { TerminalSessionAuthorityPolicyNamespacePump } from './terminal-session-authority-policy-namespace-pump'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-outcome-transport'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  notifyTerminalAuthorityPolicyConsumerFailure,
  terminalAuthorityPolicyNamespaceIsInstalled,
  terminalAuthorityPolicyNamespaceKey as namespaceKey,
  type TerminalAuthorityPolicyNamespaceOpening
} from './terminal-session-authority-policy-session-state'

export class TerminalSessionAuthorityPolicyConsumerSession {
  readonly identity: TerminalAuthorityPolicyConsumerIdentity
  readonly token = Object.freeze({})
  private readonly runtimes = new Map<string, TerminalAuthorityPolicyNamespaceOpening>()
  private readonly installedNamespaces = new Set<string>()
  private active = true
  private activated = false

  constructor(
    readonly generation: number,
    identity: TerminalAuthorityPolicyConsumerIdentity,
    private readonly expectedConsumerIncarnationId: string | null,
    private readonly transport: TerminalAuthorityPolicyOutcomeTransport,
    private readonly assertSessionCurrent: () => void,
    private readonly assertNamespaceCurrent: (namespace: TerminalAuthorityNamespace) => void,
    private readonly releaseNamespace: (namespace: TerminalAuthorityNamespace) => void
  ) {
    this.identity = Object.freeze({ ...identity })
  }

  get isActive(): boolean {
    return this.active
  }

  async stageNamespace(service: TerminalSessionAuthorityService): Promise<void> {
    this.assertCurrent()
    if (!this.activated) {
      throw new Error('terminal authority policy consumer transport is not active')
    }
    const key = namespaceKey(service.namespace)
    if (this.installedNamespaces.has(key)) {
      return
    }
    const runtime = await this.openRuntime(service)
    await runtime.stage()
    this.assertCurrent()
  }

  async commitStagedNamespace(
    namespace: TerminalAuthorityNamespace,
    seal?: TerminalAuthorityConsumerAdmissionSeal
  ): Promise<void> {
    this.assertCurrent()
    const key = namespaceKey(namespace)
    const opening = this.runtimes.get(key)
    if (!opening) {
      throw new Error('terminal authority policy consumer namespace is not staged')
    }
    const runtime = await opening.ready
    await runtime.commit(seal)
    this.installedNamespaces.add(key)
  }

  activate(): void {
    this.assertCurrent()
    if (this.activated) {
      return
    }
    this.activated = true
  }

  async acknowledge(ack: TerminalAuthorityNamespaceOutcomeAck): Promise<number> {
    this.assertCurrent()
    const runtime = await this.runtimeFor(ack.namespace)
    try {
      return await runtime.acknowledge(ack)
    } catch (error) {
      this.failRuntime(namespaceKey(ack.namespace), runtime, error)
      throw error
    }
  }

  async retire(): Promise<number> {
    this.assertCurrent()
    let retired = 0
    for (const [key, opening] of this.runtimes) {
      if (!this.installedNamespaces.has(key)) {
        continue
      }
      const runtime = await opening.ready
      if (await runtime.retire()) {
        retired += 1
      }
    }
    this.disconnect()
    return retired
  }

  isInstalled(namespace: TerminalAuthorityNamespace): boolean {
    return terminalAuthorityPolicyNamespaceIsInstalled(
      this.active,
      this.installedNamespaces,
      namespace,
      this.assertNamespaceCurrent
    )
  }

  assertInstalled(namespace: TerminalAuthorityNamespace): void {
    this.assertCurrent()
    if (!this.activated || !this.installedNamespaces.has(namespaceKey(namespace))) {
      throw new Error('terminal authority policy consumer namespace is not installed')
    }
    this.assertNamespaceCurrent(namespace)
  }

  activateNamespace(namespace: TerminalAuthorityNamespace): void {
    this.assertInstalled(namespace)
    const opening = this.runtimes.get(namespaceKey(namespace))
    if (!opening) {
      throw new Error('terminal authority policy consumer namespace is not installed')
    }
    opening.pump.startDelivery()
  }

  displaceNamespace(namespace: TerminalAuthorityNamespace): void {
    const key = namespaceKey(namespace)
    const opening = this.runtimes.get(key)
    this.runtimes.delete(key)
    this.installedNamespaces.delete(key)
    opening?.pump.disconnect()
    this.releaseNamespace(namespace)
  }

  async rollbackNamespace(namespace: TerminalAuthorityNamespace): Promise<void> {
    const key = namespaceKey(namespace)
    const opening = this.runtimes.get(key)
    if (!opening) {
      return
    }
    const runtime = await opening.ready
    const failure = await this.rollbackRuntime(key, runtime)
    if (failure) {
      throw failure
    }
  }

  disconnect(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.installedNamespaces.clear()
    for (const opening of this.runtimes.values()) {
      opening.pump.disconnect()
    }
  }

  private async runtimeFor(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalSessionAuthorityPolicyNamespacePump> {
    this.assertCurrent()
    this.assertNamespaceCurrent(namespace)
    const key = namespaceKey(namespace)
    const opening = this.runtimes.get(key)
    if (!opening || !this.installedNamespaces.has(key)) {
      throw new Error('terminal authority policy consumer namespace is not installed')
    }
    return await opening.ready
  }

  private openRuntime(
    service: TerminalSessionAuthorityService
  ): Promise<TerminalSessionAuthorityPolicyNamespacePump> {
    const key = namespaceKey(service.namespace)
    const existing = this.runtimes.get(key)
    if (existing) {
      return existing.ready
    }
    this.assertCurrent()
    let pump!: TerminalSessionAuthorityPolicyNamespacePump
    pump = new TerminalSessionAuthorityPolicyNamespacePump(
      service,
      this.identity,
      this.expectedConsumerIncarnationId,
      this.transport,
      () => this.assertRuntimeCurrent(service.namespace),
      (error) => this.failRuntime(key, pump, error)
    )
    let ready: Promise<TerminalSessionAuthorityPolicyNamespacePump>
    try {
      pump.prepare()
      this.assertCurrent()
      ready = Promise.resolve(pump)
    } catch (error) {
      pump.disconnect()
      throw error
    }
    const opening = Object.freeze({ pump, ready })
    this.runtimes.set(key, opening)
    void ready.catch(() => {
      if (this.runtimes.get(key) === opening) {
        this.runtimes.delete(key)
        this.installedNamespaces.delete(key)
      }
    })
    return ready
  }

  private async rollbackRuntime(
    key: string,
    runtime: TerminalSessionAuthorityPolicyNamespacePump
  ): Promise<unknown | null> {
    let failure: unknown | null = null
    try {
      await runtime.rollback()
    } catch (error) {
      failure = error
    } finally {
      const opening = this.runtimes.get(key)
      if (opening?.pump === runtime) {
        this.runtimes.delete(key)
      }
      this.installedNamespaces.delete(key)
      this.releaseNamespace(runtime.service.namespace)
    }
    return failure
  }

  private failRuntime(
    key: string,
    runtime: TerminalSessionAuthorityPolicyNamespacePump,
    error: unknown
  ): void {
    const opening = this.runtimes.get(key)
    if (opening?.pump !== runtime) {
      return
    }
    runtime.disconnect()
    this.runtimes.delete(key)
    this.installedNamespaces.delete(key)
    this.releaseNamespace(runtime.service.namespace)
    notifyTerminalAuthorityPolicyConsumerFailure(this.transport, error)
  }

  private assertCurrent(): void {
    if (!this.active) {
      throw new Error('terminal authority policy consumer transport is stale')
    }
    this.assertSessionCurrent()
  }

  private assertRuntimeCurrent(namespace: TerminalAuthorityNamespace): void {
    this.assertCurrent()
    if (this.installedNamespaces.has(namespaceKey(namespace))) {
      this.assertNamespaceCurrent(namespace)
    }
  }
}
