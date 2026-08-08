import { rename } from 'node:fs/promises'
import type {
  TerminalLegacyCutoverProof,
  TerminalLegacyEndpointIdentity
} from '../shared/terminal-legacy-cutover'
import type { LegacyRelayBrokerConnectionEvidence } from './legacy-relay-broker-connection-proof'
import {
  assertPosixLegacyRelayPathMissing,
  inspectPosixLegacyRelayCredentialPair,
  sealPosixLegacyRelayCredential,
  sealPosixLegacyRelayPrivateDirectory,
  validatePosixLegacyRelayCutoverPaths,
  type PosixLegacyRelayCutoverPaths
} from './legacy-relay-posix-cutover-files'
import {
  inspectPosixLegacyRelayPublicFence,
  installPosixLegacyRelayPublicFence,
  removePosixLegacyRelayPublicFence,
  runWithLegacyRelayLaunchExclusion,
  type LegacyRelayLaunchExclusion,
  type LegacyRelayPublicEndpointFenceIdentity
} from './legacy-relay-public-endpoint-fence'
import { inspectUnixEndpoint } from './legacy-relay-unix-socket-inspection'

type UnixEndpointIdentity = Extract<TerminalLegacyEndpointIdentity, { kind: 'unix-socket' }>
type PosixCutoverProof = Extract<TerminalLegacyCutoverProof, { kind: 'posix-relocated' }>

export type PosixLegacyRelayCutoverRequest = Readonly<{
  publicSocketPath: string
  privateSocketPath: string
  publicCredentialFile: string
  privateCredentialFile: string
  privateStateDirectory: string
  expectedEndpointIdentity: UnixEndpointIdentity
  brokerEvidence: LegacyRelayBrokerConnectionEvidence
  launchExclusion: LegacyRelayLaunchExclusion
  sealedAtMs?: number
}>

type PosixLegacyRelayCutoverDependencies = Readonly<{
  now?: () => number
  renamePath?: (from: string, to: string) => Promise<void>
  inspectEndpoint?: (path: string) => Promise<UnixEndpointIdentity | null>
}>

export async function relocatePosixLegacyRelaySocket(
  request: PosixLegacyRelayCutoverRequest,
  dependencies: PosixLegacyRelayCutoverDependencies = {}
): Promise<PosixCutoverProof> {
  return await runWithLegacyRelayLaunchExclusion(request.launchExclusion, async () =>
    relocatePosixLegacyRelaySocketExcluded(request, dependencies)
  )
}

async function relocatePosixLegacyRelaySocketExcluded(
  request: PosixLegacyRelayCutoverRequest,
  dependencies: PosixLegacyRelayCutoverDependencies
): Promise<PosixCutoverProof> {
  const paths = validatePosixLegacyRelayCutoverPaths(request)
  const fences = publicFenceIdentities(paths, request.expectedEndpointIdentity)
  assertBrokerEndpoint(request.brokerEvidence.endpointIdentity, request.expectedEndpointIdentity)
  const directoryDevice = await sealPosixLegacyRelayPrivateDirectory(paths.privateStateDirectory)
  const endpoint = await inspectEndpointPair(paths, fences.socket, dependencies.inspectEndpoint)
  assertExpectedEndpoint(endpoint, request.expectedEndpointIdentity)
  if (endpoint.identity.device !== directoryDevice) {
    throw new Error('legacy relay socket cannot be atomically relocated across filesystems')
  }
  const credential = await inspectPosixLegacyRelayCredentialPair(
    paths,
    fences.credential,
    directoryDevice
  )
  let movedCredential = false
  let sealedEndpointIdentity = endpoint.identity
  let movedEndpoint = false
  let socketFenced = false
  let credentialFenced = false
  try {
    if (credential.location === 'public') {
      await assertPosixLegacyRelayPathMissing(paths.privateCredentialFile)
      await (dependencies.renamePath ?? rename)(
        paths.publicCredentialFile,
        paths.privateCredentialFile
      )
      movedCredential = true
    }
    await sealPosixLegacyRelayCredential(paths.privateCredentialFile)
    if (endpoint.location === 'public') {
      await assertPosixLegacyRelayPathMissing(paths.privateSocketPath)
      await (dependencies.renamePath ?? rename)(paths.publicSocketPath, paths.privateSocketPath)
      movedEndpoint = true
      const relocated = await inspectEndpoint(paths.privateSocketPath, dependencies.inspectEndpoint)
      assertRelocatedEndpoint(relocated, request.expectedEndpointIdentity)
      sealedEndpointIdentity = relocated!
    }
    await installPosixLegacyRelayPublicFence(paths.publicSocketPath, fences.socket)
    socketFenced = true
    await installPosixLegacyRelayPublicFence(paths.publicCredentialFile, fences.credential)
    credentialFenced = true
  } catch (error) {
    await rollbackPosixCutover({
      paths,
      fences,
      movedCredential,
      movedEndpoint,
      socketFenced,
      credentialFenced,
      renamePath: dependencies.renamePath
    }).catch((rollbackError) => {
      throw new AggregateError([error, rollbackError], 'legacy relay cutover rollback failed')
    })
    throw error
  }
  return Object.freeze({
    kind: 'posix-relocated',
    publicSocketPath: paths.publicSocketPath,
    privateSocketPath: paths.privateSocketPath,
    publicCredentialFile: paths.publicCredentialFile,
    privateCredentialFile: paths.privateCredentialFile,
    endpointIdentity: sealedEndpointIdentity,
    brokerClientCount: 1,
    acceptedConnectionCount: request.brokerEvidence.acceptedConnectionCount,
    quiescenceSamples: request.brokerEvidence.quiescenceSamples,
    connectionProof: request.brokerEvidence.connectionProof,
    graceConfiguration: request.brokerEvidence.graceConfiguration,
    sealedAtMs: request.sealedAtMs ?? dependencies.now?.() ?? Date.now()
  })
}

async function inspectEndpointPair(
  paths: PosixLegacyRelayCutoverPaths,
  publicFence: LegacyRelayPublicEndpointFenceIdentity,
  inspect?: (path: string) => Promise<UnixEndpointIdentity | null>
): Promise<Readonly<{ location: 'public' | 'private'; identity: UnixEndpointIdentity }>> {
  const fenced = await inspectPosixLegacyRelayPublicFence(paths.publicSocketPath, publicFence)
  const [publicEndpoint, privateEndpoint] = await Promise.all([
    fenced ? null : inspectEndpoint(paths.publicSocketPath, inspect),
    inspectEndpoint(paths.privateSocketPath, inspect)
  ])
  if (fenced) {
    if (!privateEndpoint) {
      throw new Error('legacy relay public socket fence has no private endpoint')
    }
    return Object.freeze({ location: 'private' as const, identity: privateEndpoint })
  }
  if (Boolean(publicEndpoint) === Boolean(privateEndpoint)) {
    throw new Error('legacy relay socket relocation state is ambiguous')
  }
  return publicEndpoint
    ? Object.freeze({ location: 'public' as const, identity: publicEndpoint })
    : Object.freeze({ location: 'private' as const, identity: privateEndpoint! })
}

async function inspectEndpoint(
  path: string,
  inspect?: (path: string) => Promise<UnixEndpointIdentity | null>
): Promise<UnixEndpointIdentity | null> {
  if (inspect) {
    return await inspect(path)
  }
  try {
    return await inspectUnixEndpoint(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
}

function assertExpectedEndpoint(
  endpoint: Readonly<{ location: 'public' | 'private'; identity: UnixEndpointIdentity }>,
  expected: UnixEndpointIdentity
): void {
  assertRelocatedEndpoint(endpoint.identity, expected)
  if (endpoint.location === 'public' && endpoint.identity.changedAtNs !== expected.changedAtNs) {
    throw new Error('legacy relay Unix socket identity changed before cutover')
  }
}

function assertRelocatedEndpoint(
  actual: UnixEndpointIdentity | null,
  expected: UnixEndpointIdentity
): void {
  if (
    !actual ||
    actual.device !== expected.device ||
    actual.inode !== expected.inode ||
    BigInt(actual.changedAtNs) < BigInt(expected.changedAtNs)
  ) {
    throw new Error('legacy relay Unix socket identity changed during cutover')
  }
}

async function rollbackPosixCutover(
  input: Readonly<{
    paths: PosixLegacyRelayCutoverPaths
    fences: Readonly<{
      socket: LegacyRelayPublicEndpointFenceIdentity
      credential: LegacyRelayPublicEndpointFenceIdentity
    }>
    movedCredential: boolean
    movedEndpoint: boolean
    socketFenced: boolean
    credentialFenced: boolean
    renamePath?: (from: string, to: string) => Promise<void>
  }>
): Promise<void> {
  if (input.socketFenced) {
    await removePosixLegacyRelayPublicFence(input.paths.publicSocketPath, input.fences.socket)
  }
  if (input.credentialFenced) {
    await removePosixLegacyRelayPublicFence(
      input.paths.publicCredentialFile,
      input.fences.credential
    )
  }
  const move = input.renamePath ?? rename
  if (input.movedEndpoint) {
    await move(input.paths.privateSocketPath, input.paths.publicSocketPath)
  }
  if (input.movedCredential) {
    await move(input.paths.privateCredentialFile, input.paths.publicCredentialFile)
  }
}

function publicFenceIdentities(
  paths: PosixLegacyRelayCutoverPaths,
  endpoint: UnixEndpointIdentity
): Readonly<{
  socket: LegacyRelayPublicEndpointFenceIdentity
  credential: LegacyRelayPublicEndpointFenceIdentity
}> {
  const endpointIdentity = `${endpoint.device}:${endpoint.inode}:${endpoint.changedAtNs}`
  return Object.freeze({
    socket: Object.freeze({
      role: 'socket',
      endpointIdentity,
      privatePath: paths.privateSocketPath
    }),
    credential: Object.freeze({
      role: 'credential',
      endpointIdentity,
      privatePath: paths.privateCredentialFile
    })
  })
}

function assertBrokerEndpoint(
  actual: TerminalLegacyEndpointIdentity,
  expected: UnixEndpointIdentity
): void {
  if (
    actual.kind !== 'unix-socket' ||
    actual.device !== expected.device ||
    actual.inode !== expected.inode ||
    actual.changedAtNs !== expected.changedAtNs
  ) {
    throw new Error('legacy relay broker proof targets a different Unix socket')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
