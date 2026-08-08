import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyProcessIdentity,
  TerminalLegacyWorkerRoute
} from '../shared/terminal-legacy-cutover'
import type {
  LegacyPhysicalWorkerCapabilities,
  LegacyPhysicalWorkerClient
} from './legacy-physical-worker-client'
import type { LegacyPhysicalWorkerPty } from './legacy-physical-worker-inventory'

export type LegacyPhysicalWorkerProcessProbe = (
  process: TerminalLegacyProcessIdentity
) => Promise<boolean>

export type LegacyPhysicalWorkerRegistration = Readonly<{
  route: TerminalLegacyWorkerRoute
  cutover: TerminalLegacyCutoverProof
  client: LegacyPhysicalWorkerClient
  processMatches: LegacyPhysicalWorkerProcessProbe
  restored?: true
}>

export type LegacyPhysicalWorkerRegistrationInspection = Readonly<{
  unsupported: string | null
  inventory: readonly LegacyPhysicalWorkerPty[]
}>

export async function inspectLegacyPhysicalWorkerRegistration(
  registration: LegacyPhysicalWorkerRegistration
): Promise<LegacyPhysicalWorkerRegistrationInspection> {
  const unsupported = unsupportedCapabilities(registration.client.capabilities)
  if (unsupported) {
    return Object.freeze({ unsupported, inventory: Object.freeze([]) })
  }
  if (!routeMatchesClient(registration)) {
    return Object.freeze({
      unsupported: 'worker-route-session-mismatch',
      inventory: Object.freeze([])
    })
  }
  if (!cutoverMatchesRoute(registration)) {
    return Object.freeze({
      unsupported: 'worker-cutover-proof-mismatch',
      inventory: Object.freeze([])
    })
  }
  if (!(await legacyPhysicalWorkerRegistrationIsReachable(registration))) {
    return Object.freeze({ unsupported: 'worker-not-live', inventory: Object.freeze([]) })
  }
  try {
    const inventory = Object.freeze(await registration.client.listPtys())
    return registration.client.isOpen()
      ? Object.freeze({ unsupported: null, inventory })
      : Object.freeze({
          unsupported: 'worker-inventory-unavailable',
          inventory: Object.freeze([])
        })
  } catch {
    return Object.freeze({
      unsupported: 'worker-inventory-unavailable',
      inventory: Object.freeze([])
    })
  }
}

export async function legacyPhysicalWorkerRegistrationIsReachable(
  registration: LegacyPhysicalWorkerRegistration
): Promise<boolean> {
  if (!registration.client.isOpen()) {
    return false
  }
  try {
    const matches = await registration.processMatches(registration.route.process)
    return matches && registration.client.isOpen()
  } catch {
    return false
  }
}

function unsupportedCapabilities(capabilities: LegacyPhysicalWorkerCapabilities): string | null {
  if (capabilities.consumerSessionVersion !== 1) {
    return 'pty.openClient-version-unsupported'
  }
  if (capabilities.outputFlowControlVersion !== 1) {
    return 'source-credit-unsupported'
  }
  if ((capabilities.exactOperationsVersion === 1) !== (capabilities.mutationMode === 'exact-v1')) {
    return 'worker-mutation-mode-invalid'
  }
  return null
}

function cutoverMatchesRoute(registration: LegacyPhysicalWorkerRegistration): boolean {
  const { cutover, route, client } = registration
  if (
    (!registration.restored &&
      cutover.connectionProof.brokerConnectionIdentity !== client.brokerConnectionIdentity) ||
    !sameEndpoint(cutover.endpointIdentity, route.endpoint) ||
    cutover.privateCredentialFile !== route.credentialFile
  ) {
    return false
  }
  return cutover.kind === 'posix-relocated'
    ? cutover.privateSocketPath === route.socketPath
    : cutover.originalPipeName.toLowerCase() === route.socketPath.toLowerCase()
}

function sameEndpoint(
  left: TerminalLegacyCutoverProof['endpointIdentity'],
  right: TerminalLegacyWorkerRoute['endpoint']
): boolean {
  return left.kind === 'unix-socket' && right.kind === 'unix-socket'
    ? left.device === right.device &&
        left.inode === right.inode &&
        left.changedAtNs === right.changedAtNs
    : left.kind === 'windows-named-pipe' && right.kind === 'windows-named-pipe'
      ? left.pipeName.toLowerCase() === right.pipeName.toLowerCase() &&
        left.processCreationMarker === right.processCreationMarker
      : false
}

function routeMatchesClient(registration: LegacyPhysicalWorkerRegistration): boolean {
  return (
    registration.route.buildId === registration.client.serverBuildId &&
    registration.route.sourceOwner.ownerGeneration === registration.client.ownerGeneration &&
    registration.route.sourceOwner.ownerLease === registration.client.ownerLease &&
    registration.route.sourceOwner.outputWindowSourceUnits ===
      registration.client.capabilities.sourceWindowSu
  )
}
