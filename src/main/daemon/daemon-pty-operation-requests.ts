import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

type DaemonPtyRequest<TType extends string, TPayload extends object> = {
  id: string
  type: TType
  payload: { sessionId: string } & TPayload
}

type ExactIdentity = { incarnationId: string }
type AuthorityIdentity = { authorityAccess: TerminalSessionAuthorityPtyAccess }

export type DaemonPtyOperationRequest =
  | DaemonPtyRequest<'write', { data: string }>
  | DaemonPtyRequest<'writeExact', ExactIdentity & { data: string }>
  | DaemonPtyRequest<'resize', { cols: number; rows: number }>
  | DaemonPtyRequest<'resizeExact', ExactIdentity & { cols: number; rows: number }>
  | DaemonPtyRequest<'kill', { immediate?: boolean }>
  | DaemonPtyRequest<'killExact', ExactIdentity & { immediate?: boolean }>
  | DaemonPtyRequest<'signalExact', ExactIdentity & { signal: string }>
  | DaemonPtyRequest<'clearBufferExact', ExactIdentity>
  | DaemonPtyRequest<'writeAuthorityExact', AuthorityIdentity & { data: string }>
  | DaemonPtyRequest<'resizeAuthorityExact', AuthorityIdentity & { cols: number; rows: number }>
  | DaemonPtyRequest<'killAuthorityExact', AuthorityIdentity & { immediate?: boolean }>
  | DaemonPtyRequest<'signalAuthorityExact', AuthorityIdentity & { signal: string }>
  | DaemonPtyRequest<'clearBufferAuthorityExact', AuthorityIdentity>
