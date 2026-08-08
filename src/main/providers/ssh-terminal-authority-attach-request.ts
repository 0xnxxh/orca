import { TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION } from '../../shared/terminal-session-authority-wire'
import type { SshPtyExpectedIdentity } from './ssh-pty-provider-contract'

export function buildSshTerminalAuthorityAttachRequest(
  expected: SshPtyExpectedIdentity | undefined
): Record<string, unknown> {
  if (
    !expected?.paneKey ||
    !expected.worktreeId ||
    expected.paneGeneration === undefined ||
    !expected.ptyIncarnationId
  ) {
    return {}
  }
  return {
    terminalSessionAuthorityAttachVersion: TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION,
    expectedWorktreeId: expected.worktreeId,
    expectedPaneKey: expected.paneKey,
    expectedPtyIncarnationId: expected.ptyIncarnationId,
    expectedPaneGeneration: expected.paneGeneration
  }
}
