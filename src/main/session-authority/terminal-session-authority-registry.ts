import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertAuthorityStoragePath,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import {
  assertTerminalAuthorityNamespaceLocator,
  terminalAuthorityNamespaceLocatorKey,
  type TerminalAuthorityNamespaceLocator
} from '../../shared/terminal-session-authority-locator'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import {
  readTerminalAuthorityNamespaceIndex,
  resolveTerminalAuthorityNamespaceLimit,
  TERMINAL_AUTHORITY_NAMESPACE_INDEX_FILE,
  writeTerminalAuthorityNamespaceIndex,
  type TerminalAuthorityNamespaceEntry
} from './terminal-session-authority-namespace-index'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import {
  TERMINAL_AUTHORITY_DEFAULT_MAX_CHECKPOINT_BYTES,
  TERMINAL_AUTHORITY_DEFAULT_MAX_LOG_BYTES
} from './terminal-session-authority-file-store'
import { terminalSessionAuthorityNamespaceDirectory } from './terminal-session-authority-namespace-directory'
import { terminalAuthorityRecordFilesContainLegacyMigrations } from './terminal-session-authority-record-files'
import { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'
import { removeAuthorityCrashTemporaryFiles } from './terminal-session-authority-temporary-files'
import { TerminalSessionAuthorityLegacyRegistry } from './terminal-session-authority-legacy-registry'
import type { TerminalAuthorityRegistryOptions } from './terminal-session-authority-registry-options'
import { openTerminalAuthorityRegistryService } from './terminal-session-authority-registry-service-open'

export type { TerminalAuthorityRegistryOptions } from './terminal-session-authority-registry-options'

export class TerminalSessionAuthorityRegistry {
  private readonly entriesByLocator = new Map<string, TerminalAuthorityNamespaceEntry>()
  private readonly entriesByNamespace = new Map<string, TerminalAuthorityNamespaceEntry>()
  private readonly services = new Map<string, Promise<TerminalSessionAuthorityService>>()
  private readonly openedServices = new Map<string, TerminalSessionAuthorityService>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private accepting = true
  private closed = false
  private closePromise: Promise<void> | null = null
  readonly legacy: TerminalSessionAuthorityLegacyRegistry

  private constructor(
    private readonly options: TerminalAuthorityRegistryOptions,
    private readonly rootLock: TerminalAuthorityWriterLock,
    private readonly maxNamespaces: number,
    entries: readonly TerminalAuthorityNamespaceEntry[]
  ) {
    for (const entry of entries) {
      this.entriesByLocator.set(terminalAuthorityNamespaceLocatorKey(entry.locator), entry)
      this.entriesByNamespace.set(entry.namespaceId, entry)
    }
    this.legacy = new TerminalSessionAuthorityLegacyRegistry({
      serviceForNamespace: (namespace) => this.openNamespaceService(namespace),
      services: () => this.openedServices.values(),
      namespaceMatchesLocator: (namespace, locatorKey) =>
        this.namespaceMatchesLocator(namespace, locatorKey),
      assertNamespace: (namespace) => this.assertRegisteredNamespace(namespace),
      assertAccepting: () => this.assertAccepting(),
      now: options.legacyMigration?.now
    })
  }

  static async open(
    options: TerminalAuthorityRegistryOptions
  ): Promise<TerminalSessionAuthorityRegistry> {
    assertAuthorityStoragePath(options.directory, 'authority registry directory')
    assertAuthorityId(options.authorityHostId, 'authorityHostId')
    const directory = path.resolve(options.directory)
    const normalizedOptions = {
      ...options,
      directory,
      ...(options.legacyMigration ? { legacyMigration: { ...options.legacyMigration } } : {})
    }
    const maxNamespaces = resolveTerminalAuthorityNamespaceLimit(normalizedOptions.maxNamespaces)
    const rootLock = await TerminalAuthorityWriterLock.acquire({
      directory,
      ownerToken: normalizedOptions.ownerToken,
      takeoverOwnerToken: normalizedOptions.takeoverOwnerToken,
      allowUninitializedTakeover: normalizedOptions.takeoverOwnerToken !== undefined
    })
    let registry: TerminalSessionAuthorityRegistry | null = null
    try {
      await rootLock.runExclusive(() =>
        removeAuthorityCrashTemporaryFiles(directory, [TERMINAL_AUTHORITY_NAMESPACE_INDEX_FILE])
      )
      const entries = await readTerminalAuthorityNamespaceIndex(
        directory,
        normalizedOptions.authorityHostId,
        maxNamespaces
      )
      registry = new TerminalSessionAuthorityRegistry(
        normalizedOptions,
        rootLock,
        maxNamespaces,
        entries
      )
      await registry.openPersistedLegacyNamespaces(entries)
      return registry
    } catch (error) {
      if (registry) {
        const opened = await Promise.allSettled(registry.services.values())
        await Promise.allSettled(
          opened.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
        )
      }
      await rootLock.release().catch(() => undefined)
      throw error
    }
  }

  async resolveNamespace(
    locator: TerminalAuthorityNamespaceLocator
  ): Promise<Readonly<{ namespace: TerminalAuthorityNamespace; created: boolean }>> {
    const candidate = structuredClone(locator)
    assertTerminalAuthorityNamespaceLocator(candidate)
    return this.enqueueMutation(async () => {
      const locatorKey = terminalAuthorityNamespaceLocatorKey(candidate)
      const existing = this.entriesByLocator.get(locatorKey)
      if (existing) {
        return Object.freeze({ namespace: this.namespace(existing.namespaceId), created: false })
      }
      if (this.entriesByLocator.size >= this.maxNamespaces) {
        failTerminalSessionAuthority('capacity', 'terminal authority namespaces are full')
      }
      const entry = Object.freeze({ locator: candidate, namespaceId: this.mintNamespaceId() })
      const entries = [...this.entriesByLocator.values(), entry]
      await this.rootLock.runExclusive(() =>
        writeTerminalAuthorityNamespaceIndex(this.options.directory, {
          version: 1,
          authorityHostId: this.options.authorityHostId,
          entries
        })
      )
      this.entriesByLocator.set(locatorKey, entry)
      this.entriesByNamespace.set(entry.namespaceId, entry)
      return Object.freeze({ namespace: this.namespace(entry.namespaceId), created: true })
    })
  }

  async openNamespace(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalSessionAuthorityService> {
    const candidate = structuredClone(namespace)
    assertAuthorityNamespace(candidate)
    return this.enqueueMutation(() => this.openNamespaceService(candidate))
  }

  registeredNamespaces(): readonly Readonly<{
    locator: TerminalAuthorityNamespaceLocator
    namespace: TerminalAuthorityNamespace
  }>[] {
    this.assertAccepting()
    return Object.freeze(
      [...this.entriesByLocator.values()].map((entry) =>
        Object.freeze({
          locator: structuredClone(entry.locator),
          namespace: this.namespace(entry.namespaceId)
        })
      )
    )
  }

  namespaceForLocator(
    locator: TerminalAuthorityNamespaceLocator
  ): TerminalAuthorityNamespace | null {
    this.assertAccepting()
    assertTerminalAuthorityNamespaceLocator(locator)
    const entry = this.entriesByLocator.get(terminalAuthorityNamespaceLocatorKey(locator))
    return entry ? this.namespace(entry.namespaceId) : null
  }

  locatorForNamespace(
    namespace: TerminalAuthorityNamespace
  ): TerminalAuthorityNamespaceLocator | null {
    this.assertAccepting()
    assertAuthorityNamespace(namespace)
    if (namespace.authorityHostId !== this.options.authorityHostId) {
      return null
    }
    const entry = this.entriesByNamespace.get(namespace.namespaceId)
    return entry ? structuredClone(entry.locator) : null
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }
    this.accepting = false
    this.closePromise = (async () => {
      await Promise.all([this.mutationQueue, this.legacy.idle()])
      this.closed = true
      const services = await Promise.allSettled(this.services.values())
      await Promise.all(
        services.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
      )
      this.services.clear()
      this.openedServices.clear()
      await this.rootLock.release()
    })()
    return this.closePromise
  }

  private async openService(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalSessionAuthorityService> {
    this.options.onNamespaceServiceOpen?.(namespace)
    const service = await openTerminalAuthorityRegistryService({
      registry: this.options,
      rootLock: this.rootLock,
      namespace,
      legacyWorkerAccess: this.legacy.workerAccess
    })
    this.openedServices.set(namespace.namespaceId, service)
    await this.legacy.reconcileLiveOwners(service)
    return service
  }

  private async openPersistedLegacyNamespaces(
    entries: readonly TerminalAuthorityNamespaceEntry[]
  ): Promise<void> {
    for (const entry of entries) {
      const namespace = this.namespace(entry.namespaceId)
      const directory = terminalSessionAuthorityNamespaceDirectory(
        this.options.directory,
        namespace
      )
      const containsLegacy = await terminalAuthorityRecordFilesContainLegacyMigrations(
        directory,
        namespace,
        this.options.maxCheckpointBytes ?? TERMINAL_AUTHORITY_DEFAULT_MAX_CHECKPOINT_BYTES,
        this.options.maxLogBytes ?? TERMINAL_AUTHORITY_DEFAULT_MAX_LOG_BYTES
      )
      if (containsLegacy) {
        await this.openNamespaceService(namespace)
      }
    }
  }

  private async openNamespaceService(
    namespace: TerminalAuthorityNamespace
  ): Promise<TerminalSessionAuthorityService> {
    this.assertRegisteredNamespace(namespace)
    const existing = this.services.get(namespace.namespaceId)
    if (existing) {
      return existing
    }
    const opened = this.openService(namespace)
    this.services.set(namespace.namespaceId, opened)
    opened.catch(() => this.services.delete(namespace.namespaceId))
    return opened
  }

  private mintNamespaceId(): string {
    const createId = this.options.createNamespaceId ?? randomUUID
    for (let attempt = 0; attempt < 8; attempt++) {
      const namespaceId = createId()
      assertAuthorityId(namespaceId, 'namespaceId')
      if (!this.entriesByNamespace.has(namespaceId)) {
        return namespaceId
      }
    }
    failTerminalSessionAuthority('operation-conflict', 'could not mint a unique namespace ID')
  }

  private namespace(namespaceId: string): TerminalAuthorityNamespace {
    return Object.freeze({ authorityHostId: this.options.authorityHostId, namespaceId })
  }

  private namespaceMatchesLocator(
    namespace: TerminalAuthorityNamespace,
    locatorKey: string
  ): boolean {
    if (namespace.authorityHostId !== this.options.authorityHostId) {
      return false
    }
    const entry = this.entriesByNamespace.get(namespace.namespaceId)
    return Boolean(entry && terminalAuthorityNamespaceLocatorKey(entry.locator) === locatorKey)
  }

  private assertRegisteredNamespace(namespace: TerminalAuthorityNamespace): void {
    assertAuthorityNamespace(namespace)
    if (
      namespace.authorityHostId !== this.options.authorityHostId ||
      !this.entriesByNamespace.has(namespace.namespaceId)
    ) {
      failTerminalSessionAuthority('expectation-mismatch', 'authority namespace is not registered')
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAccepting()
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private assertAccepting(): void {
    if (!this.accepting || this.closed) {
      failTerminalSessionAuthority('writer-fenced', 'authority registry is closed')
    }
  }
}
