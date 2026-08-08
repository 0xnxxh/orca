export const TERMINAL_SESSION_AUTHORITY_SPAWN_VERSION = 1
export const TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION = 1

export function isTerminalSessionAuthorityPaneGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

export type TerminalSessionAuthorityAttachIdentity = Readonly<{
  worktreeId: string
  paneKey: string
  paneGeneration: number
  ptyIncarnationId: string
}>

export function parseTerminalSessionAuthorityAttachIdentity(
  value: Record<string, unknown>
): TerminalSessionAuthorityAttachIdentity | null {
  if (value.terminalSessionAuthorityAttachVersion === undefined) {
    return null
  }
  if (
    value.terminalSessionAuthorityAttachVersion !== TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION ||
    typeof value.expectedWorktreeId !== 'string' ||
    typeof value.expectedPaneKey !== 'string' ||
    !isTerminalSessionAuthorityPaneGeneration(value.expectedPaneGeneration) ||
    typeof value.expectedPtyIncarnationId !== 'string' ||
    value.expectedPtyIncarnationId.length === 0 ||
    value.expectedPtyIncarnationId.length > 128
  ) {
    throw new Error('terminal_session_authority_attach_identity_invalid')
  }
  return Object.freeze({
    worktreeId: value.expectedWorktreeId,
    paneKey: value.expectedPaneKey,
    paneGeneration: Number(value.expectedPaneGeneration),
    ptyIncarnationId: value.expectedPtyIncarnationId
  })
}
