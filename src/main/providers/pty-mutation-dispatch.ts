import type {
  PtyAdministrativeMutationEvidence,
  PtyMutationIdentity
} from '../../shared/pty-mutation-identity'
import {
  ptyMutationIdentitiesEqual,
  ptyMutationIdentityMatchesAdministrativeEvidence
} from '../../shared/pty-mutation-identity'
import {
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { IPtyProvider, PtyMutationMode } from './types'

export type PtyMutationDispatch =
  | { mode: 'legacy' }
  | {
      mode: 'exact'
      identity: PtyMutationIdentity
      authorityAccess: TerminalSessionAuthorityPtyAccess
    }
  | { mode: 'rejected' }

type RequestedAuthorityAccess = TerminalSessionAuthorityPtyAccess | null | undefined

const AUTHORITY_ACCESS_REJECTED = Symbol('authority-access-rejected')

export function resolvePtyMutationMode(provider: IPtyProvider, id: string): PtyMutationMode {
  return provider.getPtyMutationMode?.(id) ?? 'legacy'
}

export function resolveRendererPtyMutationDispatch(args: {
  provider: IPtyProvider
  id: string
  currentIdentity: PtyMutationIdentity | undefined
  requestedIdentity: PtyMutationIdentity | null
  requestedAuthorityAccess?: RequestedAuthorityAccess
}): PtyMutationDispatch {
  const mode = resolvePtyMutationMode(args.provider, args.id)
  if (mode === 'legacy') {
    return { mode }
  }
  if (
    mode !== 'exact' ||
    !ptyMutationIdentitiesEqual(args.currentIdentity, args.requestedIdentity)
  ) {
    return { mode: 'rejected' }
  }
  const authorityAccess = resolveAuthorityAccess(
    args.provider,
    args.id,
    args.requestedIdentity!,
    args.requestedAuthorityAccess
  )
  return authorityAccess === AUTHORITY_ACCESS_REJECTED
    ? { mode: 'rejected' }
    : { mode, identity: args.requestedIdentity!, authorityAccess }
}

export function resolveAdministrativePtyMutationDispatch(args: {
  provider: IPtyProvider
  id: string
  currentIdentity: PtyMutationIdentity | undefined
  requestedEvidence?: PtyAdministrativeMutationEvidence | null
  requestedAuthorityAccess?: RequestedAuthorityAccess
}): PtyMutationDispatch {
  const mode = resolvePtyMutationMode(args.provider, args.id)
  if (mode === 'legacy') {
    return { mode }
  }
  const evidenceAccepted =
    args.requestedEvidence === undefined ||
    ptyMutationIdentityMatchesAdministrativeEvidence(args.currentIdentity, args.requestedEvidence)
  if (mode !== 'exact' || !args.currentIdentity || !evidenceAccepted) {
    return { mode: 'rejected' }
  }
  const authorityAccess = resolveAuthorityAccess(
    args.provider,
    args.id,
    args.currentIdentity,
    args.requestedAuthorityAccess
  )
  return authorityAccess === AUTHORITY_ACCESS_REJECTED
    ? { mode: 'rejected' }
    : { mode, identity: args.currentIdentity, authorityAccess }
}

export function writePtyMutation(
  provider: IPtyProvider,
  id: string,
  dispatch: PtyMutationDispatch,
  data: string
): boolean {
  if (dispatch.mode === 'legacy') {
    provider.write(id, data)
    return true
  }
  if (dispatch.mode !== 'exact') {
    return false
  }
  return provider.writeAuthorityExact?.(id, dispatch.authorityAccess, data) === true
}

export function resizePtyMutation(
  provider: IPtyProvider,
  id: string,
  dispatch: PtyMutationDispatch,
  cols: number,
  rows: number
): boolean {
  if (dispatch.mode === 'legacy') {
    provider.resize(id, cols, rows)
    return true
  }
  if (dispatch.mode !== 'exact') {
    return false
  }
  return provider.resizeAuthorityExact?.(id, dispatch.authorityAccess, cols, rows) === true
}

export async function killPtyMutation(
  provider: IPtyProvider,
  id: string,
  dispatch: PtyMutationDispatch,
  opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
): Promise<boolean> {
  if (dispatch.mode === 'legacy') {
    await provider.shutdown(id, opts)
    return true
  }
  if (dispatch.mode !== 'exact') {
    return false
  }
  return (await provider.killAuthorityExact?.(id, dispatch.authorityAccess, opts)) === true
}

export async function signalPtyMutation(
  provider: IPtyProvider,
  id: string,
  dispatch: PtyMutationDispatch,
  signal: string
): Promise<boolean> {
  if (dispatch.mode === 'legacy') {
    await provider.sendSignal(id, signal)
    return true
  }
  if (dispatch.mode !== 'exact') {
    return false
  }
  return (await provider.sendSignalAuthorityExact?.(id, dispatch.authorityAccess, signal)) === true
}

export async function clearPtyMutation(
  provider: IPtyProvider,
  id: string,
  dispatch: PtyMutationDispatch
): Promise<boolean> {
  if (dispatch.mode === 'legacy') {
    await provider.clearBuffer(id)
    return true
  }
  if (dispatch.mode !== 'exact') {
    return false
  }
  return (await provider.clearBufferAuthorityExact?.(id, dispatch.authorityAccess)) === true
}

function resolveAuthorityAccess(
  provider: IPtyProvider,
  id: string,
  identity: PtyMutationIdentity,
  requested: RequestedAuthorityAccess
): TerminalSessionAuthorityPtyAccess | typeof AUTHORITY_ACCESS_REJECTED {
  const current = provider.getTerminalSessionAuthorityAccess?.(id) ?? null
  if (!current || current.binding.ptyIncarnationId !== identity.incarnationId) {
    return AUTHORITY_ACCESS_REJECTED
  }
  if (requested === undefined) {
    return current
  }
  if (requested === null) {
    return AUTHORITY_ACCESS_REJECTED
  }
  return sameTerminalSessionAuthorityPtyAccess(current, requested)
    ? requested
    : AUTHORITY_ACCESS_REJECTED
}
