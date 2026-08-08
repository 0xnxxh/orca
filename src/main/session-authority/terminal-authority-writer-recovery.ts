import { TerminalSessionAuthorityError } from '../../shared/terminal-session-authority-mutation'
import { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'

const MAX_WRITER_RECOVERY_STEPS = 3

export type TerminalAuthorityWriterClaimVerifier = (ownerToken: string) => Promise<boolean>

type TerminalAuthorityWriterRecoveryOptions<T> = Readonly<{
  directory: string
  open: (takeoverOwnerToken?: string) => Promise<T>
  claimIsGone: TerminalAuthorityWriterClaimVerifier
}>

export async function openTerminalAuthorityWriterWithRecovery<T>(
  options: TerminalAuthorityWriterRecoveryOptions<T>
): Promise<T> {
  let takeoverOwnerToken: string | undefined
  let lastFencedError: TerminalSessionAuthorityError | null = null
  for (let step = 0; step < MAX_WRITER_RECOVERY_STEPS; step++) {
    try {
      return await options.open(takeoverOwnerToken)
    } catch (error) {
      if (!(error instanceof TerminalSessionAuthorityError) || error.code !== 'writer-fenced') {
        throw error
      }
      lastFencedError = error
      takeoverOwnerToken = await recoverWriterClaim(options, error)
    }
  }
  throw lastFencedError ?? new Error('authority writer recovery exhausted')
}

async function recoverWriterClaim<T>(
  options: TerminalAuthorityWriterRecoveryOptions<T>,
  fencedError: TerminalSessionAuthorityError
): Promise<string | undefined> {
  const claim = await TerminalAuthorityWriterLock.readCurrentOwnerClaim(options.directory)
  const { guardOwnerToken, markerOwnerToken } = claim
  if (guardOwnerToken && guardOwnerToken !== markerOwnerToken) {
    await requireGoneClaim(guardOwnerToken, options.claimIsGone, fencedError)
    if (!(await TerminalAuthorityWriterLock.clearProvenGuard(options.directory, guardOwnerToken))) {
      throw fencedError
    }
    return undefined
  }
  const predecessorToken = markerOwnerToken ?? guardOwnerToken
  if (!predecessorToken) {
    throw fencedError
  }
  await requireGoneClaim(predecessorToken, options.claimIsGone, fencedError)
  if (markerOwnerToken === predecessorToken) {
    return predecessorToken
  }
  if (!(await TerminalAuthorityWriterLock.clearProvenGuard(options.directory, predecessorToken))) {
    throw fencedError
  }
  return undefined
}

async function requireGoneClaim(
  ownerToken: string,
  claimIsGone: TerminalAuthorityWriterClaimVerifier,
  fencedError: TerminalSessionAuthorityError
): Promise<void> {
  if (!(await claimIsGone(ownerToken))) {
    throw fencedError
  }
}
