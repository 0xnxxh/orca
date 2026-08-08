import { randomUUID } from 'node:crypto'
import type { SshTerminalAuthorityMarker } from '../shared/ssh-terminal-authority-marker'
import {
  encodeTerminalAuthorityOwnerToken,
  parseTerminalAuthorityOwnerToken
} from '../main/session-authority/terminal-session-authority-owner-token'
import {
  readCurrentTerminalAuthorityOwnerProcessIdentity,
  terminalAuthorityOwnerProcessIsGone
} from '../main/session-authority/terminal-session-authority-owner-process'

export async function createTerminalAuthorityRegistryOwnerToken(
  ownerIncarnationId: string
): Promise<string> {
  return encodeTerminalAuthorityOwnerToken(randomUUID(), {
    ownerIncarnationId,
    process: await readCurrentTerminalAuthorityOwnerProcessIdentity()
  })
}

export async function terminalAuthorityRegistryOwnerTokenIsGone(
  ownerToken: string
): Promise<boolean> {
  const proof = parseTerminalAuthorityOwnerToken(ownerToken)
  return proof ? await terminalAuthorityOwnerProcessIsGone(proof.process) : false
}

export async function terminalAuthorityMarkerOwnerIsGone(
  marker: SshTerminalAuthorityMarker
): Promise<boolean> {
  if (!marker.registryWriterOwnerToken) {
    return false
  }
  const proof = parseTerminalAuthorityOwnerToken(marker.registryWriterOwnerToken)
  if (
    !proof ||
    proof.ownerIncarnationId !== marker.ownerInstanceId ||
    proof.process.pid !== marker.ownerPid
  ) {
    return false
  }
  return await terminalAuthorityOwnerProcessIsGone(proof.process)
}
