import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyWorkerRoute
} from '../shared/terminal-legacy-cutover'
import { proveSoleLegacyRelayBroker } from './legacy-relay-broker-connection-proof'
import type { LegacyRelayBrokerConnectionEvidence } from './legacy-relay-broker-connection-proof'
import { legacyRelayCutoverExclusion } from './legacy-relay-cutover-exclusion'
import { relocatePosixLegacyRelaySocket } from './legacy-relay-posix-cutover'
import { inspectLegacyUnixSocket } from './legacy-relay-unix-socket-inspection'
import {
  inspectWindowsLegacyRelayPipe,
  queryWindowsProcessCreationMarker,
  sealWindowsLegacyRelayPipe
} from './legacy-relay-windows-cutover'
import {
  openLegacyPhysicalWorker,
  type LegacyPhysicalWorkerClient,
  type LegacyPhysicalWorkerPty
} from './legacy-physical-worker-client'
import type { LegacyPhysicalWorkerDescriptor } from './legacy-physical-worker-control-protocol'
import type { LegacyPhysicalWorkerRegistration } from './legacy-physical-worker-registration'
import { connectLegacyPhysicalWorkerSocket } from './legacy-physical-worker-socket-connection'

export type LegacyPhysicalWorkerCutoverSession = Readonly<{
  descriptor: LegacyPhysicalWorkerDescriptor
  client: LegacyPhysicalWorkerClient
  inventory: readonly LegacyPhysicalWorkerPty[]
  cutover: () => Promise<
    Readonly<{
      route: TerminalLegacyWorkerRoute
      proof: TerminalLegacyCutoverProof
      registration: LegacyPhysicalWorkerRegistration
    }>
  >
}>

export async function inspectLegacyPhysicalWorker(
  descriptor: LegacyPhysicalWorkerDescriptor
): Promise<LegacyPhysicalWorkerCutoverSession> {
  const socketPath =
    descriptor.platform === 'win32' ? descriptor.pipeName : descriptor.publicSocketPath
  const rpc = await connectLegacyPhysicalWorkerSocket({
    socketPath,
    credentialFile: descriptor.publicCredentialFile,
    expectedBuildId: descriptor.buildId
  })
  const opened = await openLegacyPhysicalWorker({
    rpc,
    clientInstanceId: descriptor.clientInstanceId,
    expectedBuildId: descriptor.buildId,
    requestedSourceWindowSu: descriptor.requestedSourceWindowSu
  })
  if (opened.status !== 'supported') {
    rpc.close()
    throw new Error(`legacy physical worker is unsupported: ${opened.reason}`)
  }
  try {
    const grace = await opened.client.prepareCutoverGrace()
    if (grace.status !== 'ready') {
      throw new Error(`legacy physical worker cannot disable grace: ${grace.reason}`)
    }
    const samples = [
      await opened.client.sampleCutoverStatus(),
      await opened.client.sampleCutoverStatus()
    ]
    const inspection =
      descriptor.platform === 'win32'
        ? await inspectWindowsLegacyRelayPipe(descriptor.pipeName, descriptor.process)
        : await inspectLegacyUnixSocket({
            platform: descriptor.platform,
            socketPath: descriptor.publicSocketPath,
            relayPid: descriptor.process.pid
          })
    const evidence = proveSoleLegacyRelayBroker({
      endpointPath: socketPath,
      relayPid: descriptor.process.pid,
      brokerConnectionIdentity: opened.client.brokerConnectionIdentity,
      samples,
      platformInspection: inspection
    })
    if (!sameEndpoint(evidence.endpointIdentity, descriptor.expectedEndpoint)) {
      throw new Error('legacy physical worker endpoint proof changed before cutover')
    }
    const inventory = Object.freeze(await opened.client.listPtys())
    let preserved: Promise<
      Readonly<{
        route: TerminalLegacyWorkerRoute
        proof: TerminalLegacyCutoverProof
        registration: LegacyPhysicalWorkerRegistration
      }>
    > | null = null
    return Object.freeze({
      descriptor,
      client: opened.client,
      inventory,
      cutover: () => {
        preserved ??= (async () => {
          const proof = await cutoverDescriptor(descriptor, evidence)
          const route = workerRoute(descriptor, opened.client, proof)
          return Object.freeze({
            route,
            proof,
            registration: Object.freeze({
              route,
              cutover: proof,
              client: opened.client,
              processMatches: () => processMatches(descriptor, route)
            })
          })
        })()
        preserved.catch(() => {
          preserved = null
        })
        return preserved
      }
    })
  } catch (error) {
    opened.client.close()
    throw error
  }
}

export async function restoreLegacyPhysicalWorker(input: {
  route: TerminalLegacyWorkerRoute
  proof: TerminalLegacyCutoverProof
}): Promise<LegacyPhysicalWorkerRegistration> {
  const rpc = await connectLegacyPhysicalWorkerSocket({
    socketPath: input.route.socketPath,
    credentialFile: input.route.credentialFile,
    expectedBuildId: input.route.buildId
  })
  const opened = await openLegacyPhysicalWorker({
    rpc,
    clientInstanceId: input.route.sourceOwner.clientInstanceId,
    expectedBuildId: input.route.buildId,
    requestedSourceWindowSu: input.route.sourceOwner.outputWindowSourceUnits,
    resume: {
      ownerGeneration: input.route.sourceOwner.ownerGeneration,
      ownerLease: input.route.sourceOwner.ownerLease
    }
  })
  if (opened.status !== 'supported') {
    rpc.close()
    throw new Error(`legacy physical worker restore is unsupported: ${opened.reason}`)
  }
  return Object.freeze({
    route: input.route,
    cutover: input.proof,
    client: opened.client,
    processMatches: () => restoredProcessMatches(input.route),
    restored: true
  })
}

async function cutoverDescriptor(
  descriptor: LegacyPhysicalWorkerDescriptor,
  brokerEvidence: LegacyRelayBrokerConnectionEvidence
): Promise<TerminalLegacyCutoverProof> {
  const launchExclusion = legacyRelayCutoverExclusion(descriptor.relayDirectory)
  return descriptor.platform === 'win32'
    ? await sealWindowsLegacyRelayPipe({
        pipeName: descriptor.pipeName,
        relayProcess: descriptor.process,
        activePipeMarkerPath: descriptor.activePipeMarkerPath,
        privateActivePipeMarkerPath: descriptor.privateActivePipeMarkerPath,
        publicCredentialFile: descriptor.publicCredentialFile,
        privateCredentialFile: descriptor.privateCredentialFile,
        privateStateDirectory: descriptor.privateStateDirectory,
        brokerEvidence,
        launchExclusion
      })
    : await relocatePosixLegacyRelaySocket({
        publicSocketPath: descriptor.publicSocketPath,
        privateSocketPath: descriptor.privateSocketPath,
        publicCredentialFile: descriptor.publicCredentialFile,
        privateCredentialFile: descriptor.privateCredentialFile,
        privateStateDirectory: descriptor.privateStateDirectory,
        expectedEndpointIdentity: unixEndpoint(descriptor.expectedEndpoint),
        brokerEvidence,
        launchExclusion
      })
}

function workerRoute(
  descriptor: LegacyPhysicalWorkerDescriptor,
  client: LegacyPhysicalWorkerClient,
  proof: TerminalLegacyCutoverProof
): TerminalLegacyWorkerRoute {
  const socketPath =
    proof.kind === 'posix-relocated' ? proof.privateSocketPath : proof.originalPipeName
  const evidencePaths =
    descriptor.platform === 'win32'
      ? [
          descriptor.pipeName,
          descriptor.activePipeMarkerPath,
          descriptor.privateActivePipeMarkerPath,
          descriptor.publicCredentialFile,
          descriptor.privateCredentialFile,
          descriptor.privateStateDirectory
        ]
      : [
          descriptor.publicSocketPath,
          descriptor.privateSocketPath,
          descriptor.publicCredentialFile,
          descriptor.privateCredentialFile,
          descriptor.privateStateDirectory
        ]
  return Object.freeze({
    routeId: descriptor.routeId,
    workerId: descriptor.workerId,
    ownerIncarnationId: descriptor.ownerIncarnationId,
    buildId: descriptor.buildId,
    relayDirectory: descriptor.relayDirectory,
    socketPath,
    credentialFile: proof.privateCredentialFile,
    process: descriptor.process,
    endpoint: proof.endpointIdentity,
    sourceOwner: Object.freeze({
      clientInstanceId: descriptor.clientInstanceId,
      ownerGeneration: client.ownerGeneration,
      ownerLease: client.ownerLease,
      outputWindowSourceUnits: client.capabilities.sourceWindowSu
    }),
    gcProtection: Object.freeze({
      relayDirectories: Object.freeze([descriptor.relayDirectory]),
      evidencePaths: Object.freeze([...new Set(evidencePaths)].sort())
    })
  })
}

async function processMatches(
  descriptor: LegacyPhysicalWorkerDescriptor,
  route: TerminalLegacyWorkerRoute
): Promise<boolean> {
  if (descriptor.platform === 'win32') {
    return (
      (await queryWindowsProcessCreationMarker(descriptor.process.pid)) ===
      descriptor.process.birthMarker
    )
  }
  try {
    const inspection = await inspectLegacyUnixSocket({
      platform: descriptor.platform,
      socketPath: route.socketPath,
      relayPid: route.process.pid
    })
    return sameEndpoint(inspection.endpointIdentity, route.endpoint)
  } catch {
    return false
  }
}

async function restoredProcessMatches(route: TerminalLegacyWorkerRoute): Promise<boolean> {
  if (route.endpoint.kind === 'windows-named-pipe') {
    return (
      (await queryWindowsProcessCreationMarker(route.process.pid)) === route.process.birthMarker
    )
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    return false
  }
  try {
    const inspection = await inspectLegacyUnixSocket({
      platform: process.platform,
      socketPath: route.socketPath,
      relayPid: route.process.pid
    })
    return sameEndpoint(inspection.endpointIdentity, route.endpoint)
  } catch {
    return false
  }
}

function unixEndpoint(
  endpoint: LegacyPhysicalWorkerDescriptor['expectedEndpoint']
): Extract<LegacyPhysicalWorkerDescriptor['expectedEndpoint'], { kind: 'unix-socket' }> {
  if (endpoint.kind !== 'unix-socket') {
    throw new Error('legacy POSIX worker endpoint identity is invalid')
  }
  return endpoint
}

function sameEndpoint(
  left: LegacyPhysicalWorkerDescriptor['expectedEndpoint'],
  right: LegacyPhysicalWorkerDescriptor['expectedEndpoint']
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
