import { rename } from 'node:fs/promises'
import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyEndpointIdentity,
  TerminalLegacyProcessIdentity
} from '../shared/terminal-legacy-cutover'
import type { LegacyRelayBrokerConnectionEvidence } from './legacy-relay-broker-connection-proof'
import {
  runWithLegacyRelayLaunchExclusion,
  type LegacyRelayLaunchExclusion,
  type LegacyRelayPublicEndpointFenceIdentity
} from './legacy-relay-public-endpoint-fence'
import {
  ensureWindowsPrivateDirectory,
  inspectWindowsLegacyRelayPublicFence,
  installWindowsLegacyRelayPublicFence,
  queryWindowsProcessCreationMarker,
  readWindowsCutoverFileSnapshot,
  removeWindowsLegacyRelayPublicFence,
  sealWindowsPrivateFile,
  type WindowsCutoverFileSnapshot
} from './legacy-relay-windows-cutover-io'
import {
  assertWindowsLegacyRelayPipeName,
  canonicalWindowsLegacyRelayPipeName,
  validateWindowsLegacyRelayCutoverPaths,
  windowsLegacyRelayPublicFenceIdentities,
  type WindowsLegacyRelayCutoverPaths
} from './legacy-relay-windows-cutover-paths'
type WindowsEndpointIdentity = Extract<
  TerminalLegacyEndpointIdentity,
  { kind: 'windows-named-pipe' }
>
type WindowsCutoverProof = Extract<TerminalLegacyCutoverProof, { kind: 'windows-sealed' }>

export type WindowsLegacyRelayPipeInspection = Readonly<{
  method: 'windows-pipe-process'
  endpointIdentity: WindowsEndpointIdentity
  listenerIdentity: string
  acceptedServerConnections: 1
}>

export type WindowsLegacyRelayCutoverRequest = Readonly<{
  pipeName: string
  relayProcess: TerminalLegacyProcessIdentity
  activePipeMarkerPath: string
  privateActivePipeMarkerPath: string
  publicCredentialFile: string
  privateCredentialFile: string
  privateStateDirectory: string
  brokerEvidence: LegacyRelayBrokerConnectionEvidence
  launchExclusion: LegacyRelayLaunchExclusion
  sealedAtMs?: number
}>

export type WindowsLegacyRelayCutoverDependencies = Readonly<{
  now?: () => number
  queryProcessCreationMarker?: (pid: number) => Promise<string | null>
  ensurePrivateDirectory?: (path: string) => Promise<void>
  readFileSnapshot?: (path: string) => Promise<WindowsCutoverFileSnapshot>
  renamePath?: (from: string, to: string) => Promise<void>
  sealPrivateFile?: (path: string) => Promise<void>
  inspectPublicFence?: (
    path: string,
    identity: LegacyRelayPublicEndpointFenceIdentity
  ) => Promise<boolean>
  installPublicFence?: (
    path: string,
    identity: LegacyRelayPublicEndpointFenceIdentity
  ) => Promise<void>
  removePublicFence?: (
    path: string,
    identity: LegacyRelayPublicEndpointFenceIdentity
  ) => Promise<void>
}>

export async function inspectWindowsLegacyRelayPipe(
  pipeName: string,
  relayProcess: TerminalLegacyProcessIdentity,
  queryCreationMarker: (pid: number) => Promise<string | null> = queryWindowsProcessCreationMarker
): Promise<WindowsLegacyRelayPipeInspection> {
  assertWindowsLegacyRelayPipeName(pipeName)
  const creationMarker = await queryCreationMarker(relayProcess.pid)
  if (!creationMarker || creationMarker !== relayProcess.birthMarker) {
    throw new Error('legacy relay Windows process identity is stale')
  }
  const endpointIdentity = Object.freeze({
    kind: 'windows-named-pipe' as const,
    pipeName,
    processCreationMarker: creationMarker
  })
  return Object.freeze({
    method: 'windows-pipe-process',
    endpointIdentity,
    listenerIdentity: `${relayProcess.pid}:windows:${creationMarker}:${canonicalWindowsLegacyRelayPipeName(pipeName)}`,
    acceptedServerConnections: 1
  })
}

export async function sealWindowsLegacyRelayPipe(
  request: WindowsLegacyRelayCutoverRequest,
  dependencies: WindowsLegacyRelayCutoverDependencies = {}
): Promise<WindowsCutoverProof> {
  return await runWithLegacyRelayLaunchExclusion(request.launchExclusion, async () =>
    sealWindowsLegacyRelayPipeExcluded(request, dependencies)
  )
}

async function sealWindowsLegacyRelayPipeExcluded(
  request: WindowsLegacyRelayCutoverRequest,
  dependencies: WindowsLegacyRelayCutoverDependencies
): Promise<WindowsCutoverProof> {
  const paths = validateWindowsLegacyRelayCutoverPaths(request)
  const fences = windowsLegacyRelayPublicFenceIdentities(
    paths,
    request.pipeName,
    request.relayProcess.birthMarker
  )
  if (request.brokerEvidence.connectionProof.method !== 'windows-pipe-process') {
    throw new Error('legacy relay Windows cutover requires pipe/process connection proof')
  }
  assertWindowsBrokerEndpoint(request)
  const query = dependencies.queryProcessCreationMarker ?? queryWindowsProcessCreationMarker
  await assertWindowsProcess(request.relayProcess, query)
  await (dependencies.ensurePrivateDirectory ?? ensureWindowsPrivateDirectory)(
    paths.privateStateDirectory
  )
  const readSnapshot = dependencies.readFileSnapshot ?? readWindowsCutoverFileSnapshot
  const inspectFence = dependencies.inspectPublicFence ?? inspectWindowsLegacyRelayPublicFence
  const credential = await inspectFilePair(
    paths.publicCredentialFile,
    paths.privateCredentialFile,
    fences.credential,
    readSnapshot,
    inspectFence,
    validateCredential
  )
  const marker = await inspectFilePair(
    paths.activePipeMarkerPath,
    paths.privateActivePipeMarkerPath,
    fences.marker,
    readSnapshot,
    inspectFence,
    (value) => assertMarkerPipe(value, request.pipeName)
  )
  const move = dependencies.renamePath ?? rename
  const sealFile = dependencies.sealPrivateFile ?? sealWindowsPrivateFile
  let movedCredential = false
  let movedMarker = false
  let credentialFenced = false
  let markerFenced = false
  try {
    if (credential.location === 'public') {
      await move(paths.publicCredentialFile, paths.privateCredentialFile)
      movedCredential = true
    }
    await sealFile(paths.privateCredentialFile)
    if (marker.location === 'public') {
      await move(paths.activePipeMarkerPath, paths.privateActivePipeMarkerPath)
      movedMarker = true
    }
    await sealFile(paths.privateActivePipeMarkerPath)
    const installFence = dependencies.installPublicFence ?? installWindowsLegacyRelayPublicFence
    await installFence(paths.publicCredentialFile, fences.credential)
    credentialFenced = true
    await installFence(paths.activePipeMarkerPath, fences.marker)
    markerFenced = true
  } catch (error) {
    await rollbackWindowsCutover({
      paths,
      fences,
      movedCredential,
      movedMarker,
      credentialFenced,
      markerFenced,
      renamePath: dependencies.renamePath,
      removePublicFence: dependencies.removePublicFence
    }).catch((rollbackError) => {
      throw new AggregateError(
        [error, rollbackError],
        'legacy relay Windows cutover rollback failed'
      )
    })
    throw error
  }
  await assertWindowsProcess(request.relayProcess, query)
  return Object.freeze({
    kind: 'windows-sealed',
    originalPipeName: request.pipeName,
    activePipeMarkerIgnored: true,
    publicCredentialFile: paths.publicCredentialFile,
    privateCredentialFile: paths.privateCredentialFile,
    endpointIdentity: Object.freeze({
      kind: 'windows-named-pipe',
      pipeName: request.pipeName,
      processCreationMarker: request.relayProcess.birthMarker
    }),
    brokerClientCount: 1,
    acceptedConnectionCount: request.brokerEvidence.acceptedConnectionCount,
    quiescenceSamples: request.brokerEvidence.quiescenceSamples,
    connectionProof: request.brokerEvidence.connectionProof,
    graceConfiguration: request.brokerEvidence.graceConfiguration,
    sealedAtMs: request.sealedAtMs ?? dependencies.now?.() ?? Date.now()
  })
}

async function inspectFilePair(
  publicPath: string,
  privatePath: string,
  publicFence: LegacyRelayPublicEndpointFenceIdentity,
  readSnapshot: (path: string) => Promise<WindowsCutoverFileSnapshot>,
  inspectFence: (
    path: string,
    identity: LegacyRelayPublicEndpointFenceIdentity
  ) => Promise<boolean>,
  validate: (content: string) => void
): Promise<Readonly<{ location: 'public' | 'private' }>> {
  const fenced = await inspectFence(publicPath, publicFence)
  const [publicFile, privateFile] = await Promise.all([
    fenced ? null : readSnapshot(publicPath),
    readSnapshot(privatePath)
  ])
  if (fenced && !privateFile) {
    throw new Error('legacy relay Windows public fence has no private state')
  }
  if (Boolean(publicFile) === Boolean(privateFile)) {
    throw new Error('legacy relay Windows sealing state is ambiguous')
  }
  validate((publicFile ?? privateFile!).content.trim())
  return Object.freeze({ location: publicFile ? 'public' : 'private' })
}

async function assertWindowsProcess(
  processIdentity: TerminalLegacyProcessIdentity,
  query: (pid: number) => Promise<string | null>
): Promise<void> {
  const marker = await query(processIdentity.pid)
  if (!marker || marker !== processIdentity.birthMarker) {
    throw new Error('legacy relay Windows process identity changed during cutover')
  }
}

function validateCredential(value: string): void {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) {
    throw new Error('legacy relay credential is invalid')
  }
}

function assertMarkerPipe(value: string, expectedPipe: string): void {
  if (
    canonicalWindowsLegacyRelayPipeName(value) !== canonicalWindowsLegacyRelayPipeName(expectedPipe)
  ) {
    throw new Error('legacy relay active-pipe marker was reused')
  }
}

function assertWindowsBrokerEndpoint(request: WindowsLegacyRelayCutoverRequest): void {
  const endpoint = request.brokerEvidence.endpointIdentity
  if (
    endpoint.kind !== 'windows-named-pipe' ||
    canonicalWindowsLegacyRelayPipeName(endpoint.pipeName) !==
      canonicalWindowsLegacyRelayPipeName(request.pipeName) ||
    endpoint.processCreationMarker !== request.relayProcess.birthMarker
  ) {
    throw new Error('legacy relay broker proof targets a different Windows pipe')
  }
}

async function rollbackWindowsCutover(
  input: Readonly<{
    paths: WindowsLegacyRelayCutoverPaths
    fences: Readonly<{
      credential: LegacyRelayPublicEndpointFenceIdentity
      marker: LegacyRelayPublicEndpointFenceIdentity
    }>
    movedCredential: boolean
    movedMarker: boolean
    credentialFenced: boolean
    markerFenced: boolean
    renamePath?: (from: string, to: string) => Promise<void>
    removePublicFence?: (
      path: string,
      identity: LegacyRelayPublicEndpointFenceIdentity
    ) => Promise<void>
  }>
): Promise<void> {
  const removeFence = input.removePublicFence ?? removeWindowsLegacyRelayPublicFence
  if (input.markerFenced) {
    await removeFence(input.paths.activePipeMarkerPath, input.fences.marker)
  }
  if (input.credentialFenced) {
    await removeFence(input.paths.publicCredentialFile, input.fences.credential)
  }
  const move = input.renamePath ?? rename
  if (input.movedMarker) {
    await move(input.paths.privateActivePipeMarkerPath, input.paths.activePipeMarkerPath)
  }
  if (input.movedCredential) {
    await move(input.paths.privateCredentialFile, input.paths.publicCredentialFile)
  }
}

export { queryWindowsProcessCreationMarker } from './legacy-relay-windows-cutover-io'
