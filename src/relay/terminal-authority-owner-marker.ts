import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
  parseSshTerminalAuthorityMarker,
  type SshTerminalAuthorityMarker
} from '../shared/ssh-terminal-authority-marker'
import { CURRENT_RELAY_DAEMON_COMPATIBILITY } from '../shared/relay-daemon-compatibility'
import {
  createRelayOwnerGuardDirectory,
  inspectRelayOwnerGuardDirectory,
  relayOwnerGuardIsOwnedBy,
  releaseRelayOwnerGuardDirectory
} from './relay-owner-guard-directory'
import {
  createTerminalAuthorityMarkerFile,
  prepareTerminalAuthorityStateDirectory,
  readOrCreateTerminalAuthorityHostId,
  readTerminalAuthorityOwnerMarker,
  replaceTerminalAuthorityMarkerFile
} from './terminal-authority-owner-marker-storage'
import {
  createTerminalAuthorityRegistryOwnerToken,
  terminalAuthorityMarkerOwnerIsGone,
  terminalAuthorityRegistryOwnerTokenIsGone
} from './terminal-authority-registry-owner-token'

const TAKEOVER_GUARD_DIRECTORY = 'takeover-lock'

export type TerminalAuthorityOwnerClaimOptions = {
  stateDir: string
  markerPath: string
  ownerBuildId: string
  ownerRelayDir: string
  socketPath: string
  credentialFile: string
  processToken: string
  takeover?: { ownerProcessToken: string; revision: number }
}

export type TerminalAuthorityOwnerClaim =
  | Readonly<{
      status: 'claimed'
      marker: SshTerminalAuthorityMarker
      mayRemoveStaleSocket: boolean
      replacedMarker?: SshTerminalAuthorityMarker
    }>
  | Readonly<{ status: 'occupied'; marker: SshTerminalAuthorityMarker }>
  | Readonly<{ status: 'contended' | 'invalid' }>

export async function claimTerminalAuthorityOwnership(
  options: TerminalAuthorityOwnerClaimOptions
): Promise<TerminalAuthorityOwnerClaim> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(options.processToken)) {
    return Object.freeze({ status: 'invalid' })
  }
  prepareTerminalAuthorityStateDirectory(options.stateDir)
  const authorityHostId = readOrCreateTerminalAuthorityHostId(options.stateDir)
  const ownerInstanceId = randomUUID()
  const registryWriterOwnerToken = await createTerminalAuthorityRegistryOwnerToken(ownerInstanceId)
  const freshMarker = createMarker(
    options,
    authorityHostId,
    ownerInstanceId,
    registryWriterOwnerToken,
    1
  )
  if (
    createTerminalAuthorityMarkerFile(
      options.markerPath,
      serializeMarker(freshMarker),
      options.stateDir
    )
  ) {
    return Object.freeze({
      status: 'claimed',
      marker: freshMarker,
      mayRemoveStaleSocket: false
    })
  }

  const existing = readTerminalAuthorityOwnerMarker(options.markerPath)
  if (!existing) {
    return Object.freeze({ status: 'invalid' })
  }
  if (!options.takeover) {
    return Object.freeze({ status: 'occupied', marker: existing })
  }

  const guardPath = join(options.stateDir, TAKEOVER_GUARD_DIRECTORY)
  if (!(await acquireTakeoverGuard(guardPath, registryWriterOwnerToken))) {
    return Object.freeze({ status: 'contended' })
  }
  let claim: TerminalAuthorityOwnerClaim
  try {
    claim = await replaceStaleOwnerMarker({
      options,
      guardPath,
      ownerInstanceId,
      registryWriterOwnerToken
    })
  } catch (error) {
    await releaseTakeoverGuard(guardPath, registryWriterOwnerToken)
    throw error
  }
  await releaseTakeoverGuard(guardPath, registryWriterOwnerToken)
  return claim
}

async function replaceStaleOwnerMarker(input: {
  options: TerminalAuthorityOwnerClaimOptions
  guardPath: string
  ownerInstanceId: string
  registryWriterOwnerToken: string
}): Promise<TerminalAuthorityOwnerClaim> {
  const current = readTerminalAuthorityOwnerMarker(input.options.markerPath)
  if (!current) {
    return Object.freeze({ status: 'invalid' })
  }
  if (!markerMatchesTakeover(current, input.options.takeover!)) {
    return Object.freeze({ status: 'occupied', marker: current })
  }
  if (!(await terminalAuthorityMarkerOwnerIsGone(current))) {
    return Object.freeze({ status: 'occupied', marker: current })
  }
  const verified = readTerminalAuthorityOwnerMarker(input.options.markerPath)
  if (!verified || !sameMarkerOwner(current, verified)) {
    return verified
      ? Object.freeze({ status: 'occupied', marker: verified })
      : Object.freeze({ status: 'invalid' })
  }
  if (!(await relayOwnerGuardIsOwnedBy(input.guardPath, input.registryWriterOwnerToken))) {
    return Object.freeze({ status: 'contended' })
  }
  const next = createMarker(
    input.options,
    current.authorityHostId,
    input.ownerInstanceId,
    input.registryWriterOwnerToken,
    current.revision + 1
  )
  replaceTerminalAuthorityMarkerFile(
    input.options.markerPath,
    serializeMarker(next),
    input.options.stateDir
  )
  return Object.freeze({
    status: 'claimed',
    marker: next,
    mayRemoveStaleSocket: true,
    replacedMarker: current
  })
}

async function releaseTakeoverGuard(guardPath: string, ownerToken: string): Promise<void> {
  if (!(await releaseRelayOwnerGuardDirectory(guardPath, ownerToken))) {
    throw new Error('Terminal authority takeover guard ownership changed before release')
  }
}

async function acquireTakeoverGuard(guardPath: string, ownerToken: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await createRelayOwnerGuardDirectory(guardPath, ownerToken)) {
      return true
    }
    const existing = await inspectRelayOwnerGuardDirectory(guardPath)
    if (existing.status === 'missing') {
      continue
    }
    if (
      attempt > 0 ||
      existing.status !== 'owned' ||
      !(await terminalAuthorityRegistryOwnerTokenIsGone(existing.ownerToken)) ||
      !(await releaseRelayOwnerGuardDirectory(guardPath, existing.ownerToken))
    ) {
      return false
    }
  }
  return false
}

function createMarker(
  options: TerminalAuthorityOwnerClaimOptions,
  authorityHostId: string,
  ownerInstanceId: string,
  registryWriterOwnerToken: string,
  revision: number
): SshTerminalAuthorityMarker {
  const marker = parseSshTerminalAuthorityMarker({
    markerVersion: SSH_TERMINAL_AUTHORITY_MARKER_VERSION,
    authorityHostId,
    ownerInstanceId,
    ownerPid: process.pid,
    ownerProcessToken: options.processToken,
    registryWriterOwnerToken,
    ownerBuildId: options.ownerBuildId,
    ownerRelayDir: options.ownerRelayDir,
    socketPath: options.socketPath,
    credentialFile: options.credentialFile,
    compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
    revision
  })
  if (!marker) {
    throw new Error('Terminal authority owner marker arguments are invalid')
  }
  return marker
}

function markerMatchesTakeover(
  marker: SshTerminalAuthorityMarker,
  takeover: NonNullable<TerminalAuthorityOwnerClaimOptions['takeover']>
): boolean {
  return (
    marker.ownerProcessToken === takeover.ownerProcessToken && marker.revision === takeover.revision
  )
}

function sameMarkerOwner(
  left: SshTerminalAuthorityMarker,
  right: SshTerminalAuthorityMarker
): boolean {
  return (
    left.authorityHostId === right.authorityHostId &&
    left.ownerInstanceId === right.ownerInstanceId &&
    left.ownerPid === right.ownerPid &&
    left.ownerProcessToken === right.ownerProcessToken &&
    left.registryWriterOwnerToken === right.registryWriterOwnerToken &&
    left.revision === right.revision
  )
}

function serializeMarker(marker: SshTerminalAuthorityMarker): string {
  return `${JSON.stringify(marker)}\n`
}
