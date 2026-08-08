import { isPtyIncarnationId, type PtyIncarnationId } from '../../shared/pty-incarnation'
import {
  parseTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'

export type PtyListedKillTarget = Readonly<{
  id: string
  incarnationId?: PtyIncarnationId
  terminalSessionAuthorityAccess?: TerminalSessionAuthorityPtyAccess
  mutationRouteToken?: object
}>

export type PtyListedKillOptions = Readonly<{
  immediate?: boolean
  keepHistory?: boolean
  deadlineMs?: number
}>

type PtyListedKillProvider = Readonly<{
  getPtyMutationRouteToken?: (id: string) => object | null
  killExact?: (
    id: string,
    incarnationId: PtyIncarnationId,
    opts: PtyListedKillOptions
  ) => boolean | Promise<boolean>
  killAuthorityExact?: (
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess,
    opts: PtyListedKillOptions
  ) => boolean | Promise<boolean>
}>

export async function killListedPty(
  provider: PtyListedKillProvider,
  target: PtyListedKillTarget,
  opts: PtyListedKillOptions
): Promise<boolean> {
  const access = listedPtyAuthorityAccess(target)
  if (target.terminalSessionAuthorityAccess !== undefined) {
    if (!access || !listedPtyRouteIsCurrent(provider, target)) {
      return false
    }
    return (await provider.killAuthorityExact?.(target.id, access, opts)) === true
  }
  if (!isPtyIncarnationId(target.incarnationId) || !listedPtyRouteIsCurrent(provider, target)) {
    return false
  }
  return (await provider.killExact?.(target.id, target.incarnationId, opts)) === true
}

export function listedPtyIdentityKey(target: PtyListedKillTarget): string | null {
  const access = listedPtyAuthorityAccess(target)
  if (target.terminalSessionAuthorityAccess !== undefined) {
    return access
      ? JSON.stringify([
          'authority',
          target.id,
          access.namespace.authorityHostId,
          access.namespace.namespaceId,
          access.pane.paneKey,
          access.pane.paneGenerationId,
          access.binding.ownerIncarnationId,
          access.binding.physicalPtyId,
          access.binding.ptyIncarnationId
        ])
      : null
  }
  return isPtyIncarnationId(target.incarnationId)
    ? JSON.stringify(['incarnation', target.id, target.incarnationId])
    : null
}

export function listedPtyIncarnationId(target: PtyListedKillTarget): PtyIncarnationId | null {
  const access = listedPtyAuthorityAccess(target)
  if (target.terminalSessionAuthorityAccess !== undefined) {
    return access?.binding.ptyIncarnationId ?? null
  }
  return isPtyIncarnationId(target.incarnationId) ? target.incarnationId : null
}

function listedPtyAuthorityAccess(
  target: PtyListedKillTarget
): TerminalSessionAuthorityPtyAccess | null {
  const access = parseTerminalSessionAuthorityPtyAccess(target.terminalSessionAuthorityAccess)
  return access &&
    (target.incarnationId === undefined || target.incarnationId === access.binding.ptyIncarnationId)
    ? access
    : null
}

function listedPtyRouteIsCurrent(
  provider: PtyListedKillProvider,
  target: PtyListedKillTarget
): boolean {
  if (
    typeof target.mutationRouteToken !== 'object' ||
    target.mutationRouteToken === null ||
    !provider.getPtyMutationRouteToken
  ) {
    return false
  }
  try {
    return provider.getPtyMutationRouteToken(target.id) === target.mutationRouteToken
  } catch {
    return false
  }
}
