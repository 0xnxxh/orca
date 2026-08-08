import type { IPtyProvider, PtyProcessInfo } from '../providers/types'
import { killListedPty, listedPtyIncarnationId } from '../providers/pty-listed-session-kill'
import { isSshPtyNotFoundError } from '../providers/ssh-pty-errors'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import { toAppSshPtyId, toRelaySshPtyId } from '../../shared/ssh-pty-id'
import {
  parseTerminalSessionAuthorityPtyAccess,
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'

type SshTerminationCandidate = {
  relayPtyId: string
  appPtyId: string
  expectedIncarnations: Set<string>
  expectedAuthorityAccesses: TerminalSessionAuthorityPtyAccess[]
  keepHistory: boolean
}

export type SshTerminalSessionTermination = Readonly<{
  relayPtyId: string
  appPtyId: string
  status: 'terminated' | 'acceptedPending' | 'unknown' | 'rejected'
  error?: Error
}>

export type SshTerminalAuthorityExitTarget = Readonly<{
  targetId: string
  relayPtyId: string
  appPtyId: string
  authorityAccess: TerminalSessionAuthorityPtyAccess
}>

export type SshTerminalAuthorityExitWait = Readonly<{
  completion: Promise<boolean>
  cancelUnsent: () => void
  dispose: () => void
}>

export async function terminateListedSshTerminalSessions(input: {
  targetId: string
  provider: IPtyProvider
  trackedPtyIds: readonly string[]
  leases: readonly SshRemotePtyLease[]
  prepareAuthorityExitWait?: (
    target: SshTerminalAuthorityExitTarget
  ) => SshTerminalAuthorityExitWait
  isCurrent?: () => boolean
  usePersistedCloseOptions?: boolean
}): Promise<readonly SshTerminalSessionTermination[]> {
  if (input.isCurrent?.() === false) {
    throw new Error('ssh_pty_termination_provider_superseded')
  }
  const candidates = collectCandidates(
    input.targetId,
    input.trackedPtyIds,
    input.leases,
    input.usePersistedCloseOptions === true
  )
  const inventory = indexInventory(input.targetId, await input.provider.listProcesses())
  if (input.isCurrent?.() === false) {
    throw new Error('ssh_pty_termination_provider_superseded')
  }
  return await Promise.all(
    [...candidates.values()].map(async (candidate) => {
      const listed = inventory.get(candidate.relayPtyId)
      if (listed === undefined) {
        return unknown(candidate, 'ssh_pty_termination_inventory_missing')
      }
      if (listed === null || !candidateMatchesInventory(candidate, listed)) {
        return rejected(candidate, 'ssh_pty_termination_identity_ambiguous')
      }
      const authorityAccess =
        candidate.expectedAuthorityAccesses.length === 1
          ? candidate.expectedAuthorityAccesses[0]
          : parseTerminalSessionAuthorityPtyAccess(listed.terminalSessionAuthorityAccess)
      let exitWait: SshTerminalAuthorityExitWait | null = null
      if (authorityAccess) {
        if (!input.prepareAuthorityExitWait) {
          return rejected(candidate, 'ssh_pty_termination_outcome_wait_unavailable')
        }
        try {
          exitWait = input.prepareAuthorityExitWait({
            targetId: input.targetId,
            ...candidateIds(candidate),
            authorityAccess
          })
        } catch (error) {
          return rejected(candidate, error)
        }
      }
      try {
        if (input.isCurrent?.() === false) {
          exitWait?.cancelUnsent()
          return unknown(candidate, 'ssh_pty_termination_provider_superseded')
        }
        const accepted = await killListedPty(
          input.provider,
          authorityAccess
            ? {
                ...listed,
                incarnationId: authorityAccess.binding.ptyIncarnationId,
                terminalSessionAuthorityAccess: authorityAccess
              }
            : listed,
          {
            immediate: true,
            keepHistory: candidate.keepHistory
          }
        )
        if (!accepted) {
          exitWait?.cancelUnsent()
          return rejected(candidate, 'ssh_pty_termination_identity_rejected')
        }
        if (!authorityAccess) {
          return { ...candidateIds(candidate), status: 'terminated' as const }
        }
        let exited: boolean
        try {
          exited = (await exitWait?.completion) === true
        } catch (error) {
          return {
            ...candidateIds(candidate),
            status: 'acceptedPending' as const,
            error: error instanceof Error ? error : new Error(String(error))
          }
        }
        return {
          ...candidateIds(candidate),
          status: exited ? ('terminated' as const) : ('acceptedPending' as const)
        }
      } catch (error) {
        return isSshPtyNotFoundError(error) ? unknown(candidate, error) : rejected(candidate, error)
      } finally {
        exitWait?.dispose()
      }
    })
  )
}

function unknown(
  candidate: SshTerminationCandidate,
  error: unknown
): SshTerminalSessionTermination {
  return {
    ...candidateIds(candidate),
    status: 'unknown',
    error: error instanceof Error ? error : new Error(String(error))
  }
}

function collectCandidates(
  targetId: string,
  trackedPtyIds: readonly string[],
  leases: readonly SshRemotePtyLease[],
  usePersistedCloseOptions: boolean
): Map<string, SshTerminationCandidate> {
  const candidates = new Map<string, SshTerminationCandidate>()
  const add = (
    ptyId: string,
    incarnationId?: string,
    authorityAccess?: TerminalSessionAuthorityPtyAccess,
    keepHistory = false
  ): void => {
    const relayPtyId = toRelaySshPtyId(targetId, ptyId)
    let candidate = candidates.get(relayPtyId)
    if (!candidate) {
      candidate = {
        relayPtyId,
        appPtyId: toAppSshPtyId(targetId, relayPtyId),
        expectedIncarnations: new Set(),
        expectedAuthorityAccesses: [],
        keepHistory: false
      }
      candidates.set(relayPtyId, candidate)
    }
    if (incarnationId) {
      candidate.expectedIncarnations.add(incarnationId)
    }
    candidate.keepHistory ||= keepHistory
    const parsedAccess = parseTerminalSessionAuthorityPtyAccess(authorityAccess)
    if (
      parsedAccess &&
      !candidate.expectedAuthorityAccesses.some((current) =>
        sameTerminalSessionAuthorityPtyAccess(current, parsedAccess)
      )
    ) {
      candidate.expectedAuthorityAccesses.push(parsedAccess)
    }
  }
  for (const ptyId of trackedPtyIds) {
    add(ptyId)
  }
  for (const lease of leases) {
    if (lease.state !== 'terminated') {
      add(
        lease.ptyId,
        lease.incarnationId,
        lease.pendingClose?.terminalSessionAuthorityAccess ?? lease.terminalSessionAuthorityAccess,
        usePersistedCloseOptions && lease.pendingClose?.keepHistory === true
      )
    }
  }
  return candidates
}

function indexInventory(
  targetId: string,
  sessions: readonly PtyProcessInfo[]
): Map<string, PtyProcessInfo | null> {
  const indexed = new Map<string, PtyProcessInfo | null>()
  for (const session of sessions) {
    const relayPtyId = toRelaySshPtyId(targetId, session.id)
    indexed.set(relayPtyId, indexed.has(relayPtyId) ? null : session)
  }
  return indexed
}

function candidateMatchesInventory(
  candidate: SshTerminationCandidate,
  listed: PtyProcessInfo
): boolean {
  if (candidate.expectedAuthorityAccesses.length > 0) {
    const expectedAccess = candidate.expectedAuthorityAccesses[0]
    const listedAccess = parseTerminalSessionAuthorityPtyAccess(
      listed.terminalSessionAuthorityAccess
    )
    if (
      candidate.expectedAuthorityAccesses.length !== 1 ||
      !expectedAccess ||
      !sameTerminalSessionAuthorityPtyAccess(listedAccess, expectedAccess)
    ) {
      return false
    }
  }
  if (candidate.expectedIncarnations.size === 0) {
    return true
  }
  const listedIncarnation = listedPtyIncarnationId(listed)
  return (
    candidate.expectedIncarnations.size === 1 &&
    listedIncarnation !== null &&
    candidate.expectedIncarnations.has(listedIncarnation)
  )
}

function rejected(
  candidate: SshTerminationCandidate,
  error: unknown
): SshTerminalSessionTermination {
  return {
    ...candidateIds(candidate),
    status: 'rejected',
    error: error instanceof Error ? error : new Error(String(error))
  }
}

function candidateIds(candidate: SshTerminationCandidate): {
  relayPtyId: string
  appPtyId: string
} {
  return { relayPtyId: candidate.relayPtyId, appPtyId: candidate.appPtyId }
}
