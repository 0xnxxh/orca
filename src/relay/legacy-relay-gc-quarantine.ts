import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { TerminalLegacyGcProtection } from '../shared/terminal-legacy-cutover'
import {
  assertLegacyRelayGcCandidatePath,
  defaultLegacyRelayGcFileSystem,
  legacyRelayGcCandidateIsProtected,
  readLegacyRelayGcPathIdentity,
  sameLegacyRelayGcPathIdentity,
  type LegacyRelayGcCandidate,
  type LegacyRelayGcFileSystem,
  type LegacyRelayGcPathIdentity
} from './legacy-relay-gc-path-policy'

export type LegacyRelayGcQuarantineHold = Readonly<{
  originalPath: string
  canonicalPath: string
  quarantinePath: string
  identity: LegacyRelayGcPathIdentity
}>

export type LegacyRelayGcRemovalResult =
  | Readonly<{ status: 'removed' | 'missing' | 'protected' }>
  | Readonly<{
      status: 'preserved'
      hold: LegacyRelayGcQuarantineHold
      reason: 'identity-changed' | 'protection-changed' | 'original-replaced'
    }>

export function createLegacyRelayGcQuarantineHold(
  candidate: LegacyRelayGcCandidate,
  allowedRoots: readonly string[]
): LegacyRelayGcQuarantineHold {
  const api = pathApi(candidate.reportedPath)
  const quarantinePath = api.join(
    api.dirname(candidate.reportedPath),
    `.${api.basename(candidate.reportedPath)}.terminal-authority-gc-${randomUUID()}`
  )
  assertLegacyRelayGcCandidatePath(quarantinePath, allowedRoots)
  return Object.freeze({
    originalPath: candidate.reportedPath,
    canonicalPath: candidate.removalPath,
    quarantinePath,
    identity: candidate.identity
  })
}

export async function quarantineAndRemoveLegacyRelayGcCandidate(input: {
  candidate: LegacyRelayGcCandidate
  hold: LegacyRelayGcQuarantineHold
  allowedRoots: readonly string[]
  protection: () => TerminalLegacyGcProtection
  fileSystem?: LegacyRelayGcFileSystem
}): Promise<LegacyRelayGcRemovalResult> {
  const fileSystem = input.fileSystem ?? defaultLegacyRelayGcFileSystem
  if (await legacyRelayGcCandidateIsProtected(input.candidate, input.protection(), fileSystem)) {
    return Object.freeze({ status: 'protected' })
  }
  try {
    await fileSystem.rename(input.hold.originalPath, input.hold.quarantinePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ status: 'missing' })
    }
    throw error
  }
  return await removeExistingQuarantine(input)
}

export async function resumeLegacyRelayGcQuarantine(input: {
  candidate: LegacyRelayGcCandidate
  hold: LegacyRelayGcQuarantineHold
  allowedRoots: readonly string[]
  protection: () => TerminalLegacyGcProtection
  fileSystem?: LegacyRelayGcFileSystem
}): Promise<LegacyRelayGcRemovalResult> {
  const fileSystem = input.fileSystem ?? defaultLegacyRelayGcFileSystem
  const quarantineIdentity = await readLegacyRelayGcPathIdentity(
    input.hold.quarantinePath,
    fileSystem
  )
  if (!quarantineIdentity) {
    return Object.freeze({ status: 'missing' })
  }
  if (await readLegacyRelayGcPathIdentity(input.hold.originalPath, fileSystem)) {
    return preserved(input.hold, 'original-replaced')
  }
  return await removeExistingQuarantine({ ...input, fileSystem })
}

async function removeExistingQuarantine(input: {
  candidate: LegacyRelayGcCandidate
  hold: LegacyRelayGcQuarantineHold
  allowedRoots: readonly string[]
  protection: () => TerminalLegacyGcProtection
  fileSystem?: LegacyRelayGcFileSystem
}): Promise<LegacyRelayGcRemovalResult> {
  const fileSystem = input.fileSystem ?? defaultLegacyRelayGcFileSystem
  const quarantinedIdentity = await readLegacyRelayGcPathIdentity(
    input.hold.quarantinePath,
    fileSystem
  )
  if (!sameLegacyRelayGcPathIdentity(quarantinedIdentity, input.hold.identity)) {
    return preserved(input.hold, 'identity-changed')
  }
  const canonicalQuarantine = await fileSystem.realpath(input.hold.quarantinePath)
  assertLegacyRelayGcCandidatePath(canonicalQuarantine, input.allowedRoots)
  if (await legacyRelayGcCandidateIsProtected(input.candidate, input.protection(), fileSystem)) {
    return preserved(input.hold, 'protection-changed')
  }
  const finalIdentity = await readLegacyRelayGcPathIdentity(input.hold.quarantinePath, fileSystem)
  if (!sameLegacyRelayGcPathIdentity(finalIdentity, input.hold.identity)) {
    return preserved(input.hold, 'identity-changed')
  }
  await fileSystem.rm(input.hold.quarantinePath, { recursive: true, force: false })
  return Object.freeze({ status: 'removed' })
}

function preserved(
  hold: LegacyRelayGcQuarantineHold,
  reason: Extract<LegacyRelayGcRemovalResult, { status: 'preserved' }>['reason']
): LegacyRelayGcRemovalResult {
  return Object.freeze({ status: 'preserved', hold, reason })
}

function pathApi(candidate: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\') ? path.win32 : path.posix
}
