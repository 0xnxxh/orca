import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL,
  TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE
} from '../../shared/terminal-authority-app-projection'
import { parseTerminalAuthorityAppBellClearRequest } from '../../shared/terminal-authority-app-projection-validation'
import {
  assertAuthorityId,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityConsumerRetirementResult } from '../../shared/terminal-session-authority-consumer-retirement'
import type { TerminalAuthorityAppConsumerRetirementRequest } from '../session-authority/terminal-authority-app-outcome-host-contract'
import { ensureActiveOrcaProfile } from '../orca-profiles/profile-index-store'
import {
  TerminalAuthorityAppOutcomeHostManager,
  type TerminalAuthorityAppOutcomeHostRegistration
} from '../session-authority/terminal-authority-app-outcome-host-manager'
import type {
  TerminalAuthorityAppNamespaceAdmission,
  TerminalAuthorityAppOutcomeHostTransport
} from '../session-authority/terminal-authority-app-outcome-host-contract'
import {
  TerminalAuthorityAppOutcomeHostTransportSlot,
  type TerminalAuthorityAppOutcomeHostTransportLease
} from '../session-authority/terminal-authority-app-outcome-host-transport-slot'
import { TerminalAuthorityAppProjectionStore } from '../session-authority/terminal-authority-app-projection-store'
import { PtyAuthorityProjectionBroker } from './pty-authority-projection-broker'
import { PtyAuthorityOutcomeRendererBinding } from './pty-authority-outcome-renderer-binding'

type AppProjectionRuntime = Readonly<{
  store: TerminalAuthorityAppProjectionStore
  manager: TerminalAuthorityAppOutcomeHostManager
}>

type RegisterPtyAuthorityOutcomeIpcOptions = Readonly<{
  processIncarnationId?: string
  projectionStore?:
    | TerminalAuthorityAppProjectionStore
    | Promise<TerminalAuthorityAppProjectionStore>
  hostTransport?: TerminalAuthorityAppOutcomeHostTransport
}>

export type PtyAuthorityOutcomeHostRegistration = TerminalAuthorityAppNamespaceAdmission &
  Readonly<{
    authenticatedAuthorityHostId: string
    knownNamespaceIds(): readonly string[]
    retireNamespace: TerminalAuthorityAppOutcomeHostRegistration['retireNamespace']
    dispose(): void
  }>

export type PtyAuthorityOutcomeResetTarget = Readonly<{
  authenticatedAuthorityHostId: string
  namespaceIds: readonly string[]
  retireNamespace(
    namespaceId: string,
    request: TerminalAuthorityAppConsumerRetirementRequest
  ): Promise<TerminalAuthorityConsumerRetirementResult>
}>

let runtimeSnapshot: AppProjectionRuntime | null = null
let runtimeReady: Promise<AppProjectionRuntime> | null = null
type PendingHostInstallation = {
  slot: TerminalAuthorityAppOutcomeHostTransportSlot
  registration: TerminalAuthorityAppOutcomeHostRegistration | null
  ready: Promise<TerminalAuthorityAppOutcomeHostRegistration>
}

const hostInstallations = new Map<string, PendingHostInstallation>()
let authorityAdmissionsFrozen = false
const broker = new PtyAuthorityProjectionBroker(() => {
  if (!runtimeSnapshot) {
    throw new Error('terminal authority app projection is unavailable')
  }
  return runtimeSnapshot.store.snapshotAll()
})
const rendererBinding = new PtyAuthorityOutcomeRendererBinding(broker)

export function registerPtyAuthorityOutcomeIpc(
  mainWindow: BrowserWindow,
  options: RegisterPtyAuthorityOutcomeIpcOptions = {}
): void {
  void ensureRuntime(options)
  if (options.hostTransport) {
    installPtyAuthorityOutcomeHostTransport(options.hostTransport)
  }
  rendererBinding.bind(mainWindow)
  ipcMain.removeHandler(TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE)
  ipcMain.handle(TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE, async (event, value: unknown) => {
    const admission = broker.admitRendererRequest(event.sender)
    await ensureRuntime()
    return broker.subscribe(event.sender, value, admission)
  })
  ipcMain.removeHandler(TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL)
  ipcMain.handle(TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL, async (event, value: unknown) => {
    const admission = broker.admitRendererRequest(event.sender)
    const runtime = await ensureRuntime()
    if (admission.rendererToken !== event.sender) {
      throw new Error('terminal_authority_projection_sender_stale')
    }
    const request = parseTerminalAuthorityAppBellClearRequest(value)
    if (!request) {
      throw new Error('terminal_authority_projection_bell_clear_invalid')
    }
    const changed = runtime.store.clearBell(request)
    if (changed) {
      broker.publish([changed], [])
    }
    return changed !== null
  })
}

export function installPtyAuthorityOutcomeHostTransport(
  transport: TerminalAuthorityAppOutcomeHostTransport
): PtyAuthorityOutcomeHostRegistration {
  const hostId = transport.authenticatedAuthorityHostId
  assertAuthorityId(hostId, 'authenticatedAuthorityHostId')
  const existing = hostInstallations.get(hostId)
  if (existing) {
    return sourceRegistration(existing, existing.slot.install(transport))
  }
  const slot = new TerminalAuthorityAppOutcomeHostTransportSlot(hostId)
  const source = slot.install(transport)
  let installation!: PendingHostInstallation
  const ready = ensureRuntime().then((runtime) => {
    if (hostInstallations.get(hostId) !== installation) {
      throw new Error('terminal authority app outcome host installation is stale')
    }
    const registration = runtime.manager.installHost(slot)
    installation.registration = registration
    return registration
  })
  installation = {
    slot,
    registration: null,
    ready
  }
  hostInstallations.set(hostId, installation)
  void installation.ready.catch((error) => {
    if (hostInstallations.get(hostId) === installation) {
      console.error('[terminal-authority] app outcome transport unavailable', error)
    }
  })
  return sourceRegistration(installation, source)
}

/** Blocks new app namespace admissions while allowing reset retirement calls through. */
export function setPtyAuthorityOutcomeAdmissionFrozen(frozen: boolean): void {
  authorityAdmissionsFrozen = frozen
}

export function isPtyAuthorityOutcomeAdmissionFrozen(): boolean {
  return authorityAdmissionsFrozen
}

/** Returns the app authority manager's process identity for exact reset proofs. */
export function getPtyAuthorityOutcomeProcessIncarnationId(): string | null {
  return runtimeSnapshot?.manager.getProcessIncarnationId() ?? null
}

/** Returns the authenticated in-memory host/session inventory captured by the reset record. */
export function listPtyAuthorityOutcomeResetTargets(): readonly PtyAuthorityOutcomeResetTarget[] {
  return Object.freeze(
    [...hostInstallations.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([hostId, installation]) => {
        const knownNamespaceIds = installation.registration?.knownNamespaceIds() ?? []
        return Object.freeze({
          authenticatedAuthorityHostId: hostId,
          namespaceIds: Object.freeze([...knownNamespaceIds].sort()),
          retireNamespace: async (
            namespaceId: string,
            request: TerminalAuthorityAppConsumerRetirementRequest
          ) => {
            const registration = await installation.ready
            if (!registration.knownNamespaceIds().includes(namespaceId)) {
              throw new Error(
                `terminal authority app outcome namespace is unresolved: ${namespaceId}`
              )
            }
            return await registration.retireNamespace(request)
          }
        })
      })
  )
}

/** Drops all old authenticated host/session consumers after retirement acknowledgements commit. */
export function disposePtyAuthorityOutcomeResetTransports(): void {
  for (const installation of hostInstallations.values()) {
    installation.registration?.dispose()
    installation.slot.dispose()
  }
  hostInstallations.clear()
}

function sourceRegistration(
  installation: PendingHostInstallation,
  source: TerminalAuthorityAppOutcomeHostTransportLease
): PtyAuthorityOutcomeHostRegistration {
  const hostId = installation.slot.authenticatedAuthorityHostId
  const withSourceAdmission: TerminalAuthorityAppNamespaceAdmission['withSourceAdmission'] = async (
    locator,
    operation
  ) => {
    assertAuthorityOutcomeAdmissionOpen()
    return await source.withCurrent(async (sourceBinding) => {
      if (hostInstallations.get(hostId) !== installation || !source.isActive()) {
        throw new Error('terminal authority app outcome host installation is stale')
      }
      const registration = await installation.ready
      const resolved =
        'namespace' in locator
          ? {
              namespace: locator.namespace,
              binding: await registration.bindNamespace(locator.namespace)
            }
          : await registration.resolveAndBindNamespace(locator.worktreeId)
      sourceBinding.bindConnectionGeneration()
      const binding = Object.freeze({
        namespace: Object.freeze({ ...resolved.namespace }),
        assertCurrent: () => {
          sourceBinding.assertCurrent()
          resolved.binding.assertCurrent()
        }
      })
      binding.assertCurrent()
      const result = await operation(binding)
      binding.assertCurrent()
      return result
    })
  }
  return Object.freeze({
    authenticatedAuthorityHostId: hostId,
    knownNamespaceIds: () => installation.registration?.knownNamespaceIds() ?? [],
    admitNamespace: (namespace: TerminalAuthorityNamespace) => {
      assertAuthorityOutcomeAdmissionOpen()
      return withSourceAdmission({ namespace }, async () => undefined)
    },
    resolveAndAdmitNamespace: (worktreeId: string) => {
      assertAuthorityOutcomeAdmissionOpen()
      return withSourceAdmission({ worktreeId }, async ({ namespace }) => namespace)
    },
    withSourceAdmission,
    retireNamespace: (request) =>
      source.withCurrent(async (binding) => {
        const registration = await installation.ready
        binding.bindConnectionGeneration()
        return await registration.retireNamespace(request)
      }),
    dispose: () => {
      source.dispose()
    }
  })
}

function assertAuthorityOutcomeAdmissionOpen(): void {
  if (authorityAdmissionsFrozen) {
    throw new Error('terminal authority app outcome admission is frozen for identity reset')
  }
}

function ensureRuntime(
  options: RegisterPtyAuthorityOutcomeIpcOptions = {}
): Promise<AppProjectionRuntime> {
  if (!runtimeReady) {
    const profileDirectory = ensureActiveOrcaProfile().profileDirectory
    const processIncarnationId = options.processIncarnationId ?? `app-process:${randomUUID()}`
    assertAppProcessIncarnationId(processIncarnationId)
    runtimeReady = Promise.resolve(
      options.projectionStore ??
        TerminalAuthorityAppProjectionStore.open({ directory: profileDirectory })
    ).then((store) => {
      const manager = new TerminalAuthorityAppOutcomeHostManager(processIncarnationId, {
        store,
        onProjection: (change) => broker.publish(change.rows, change.deleted),
        onError: (error) => console.error('[terminal-authority] app outcome pump failed', error)
      })
      runtimeSnapshot = Object.freeze({ store, manager })
      return runtimeSnapshot
    })
    void runtimeReady.catch(() => undefined)
  }
  return runtimeReady
}

function assertAppProcessIncarnationId(value: string): void {
  assertAuthorityId(value, 'app process incarnation')
  if (!value.startsWith('app-process:')) {
    throw new Error('terminal authority app process incarnation is invalid')
  }
}
