import { describe, expect, it } from 'vitest'
import {
  TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION,
  parseTerminalSessionAuthorityAttachIdentity
} from './terminal-session-authority-wire'

describe('terminal session authority attach wire', () => {
  it('keeps missing metadata distinguishable from malformed current metadata', () => {
    expect(parseTerminalSessionAuthorityAttachIdentity({})).toBeNull()
    expect(() =>
      parseTerminalSessionAuthorityAttachIdentity({
        terminalSessionAuthorityAttachVersion: TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION,
        expectedWorktreeId: 'repo::/srv/repo',
        expectedPaneKey: 'pane-a'
      })
    ).toThrow('terminal_session_authority_attach_identity_invalid')
  })

  it('requires exact PTY identity and preserves renderer generation zero', () => {
    const base = {
      terminalSessionAuthorityAttachVersion: TERMINAL_SESSION_AUTHORITY_ATTACH_VERSION,
      expectedWorktreeId: 'repo::/srv/repo',
      expectedPaneKey: 'pane-a',
      expectedPtyIncarnationId: 'incarnation-a'
    }
    expect(() => parseTerminalSessionAuthorityAttachIdentity(base)).toThrow(
      'terminal_session_authority_attach_identity_invalid'
    )
    expect(
      parseTerminalSessionAuthorityAttachIdentity({ ...base, expectedPaneGeneration: 0 })
    ).toEqual({
      worktreeId: 'repo::/srv/repo',
      paneKey: 'pane-a',
      paneGeneration: 0,
      ptyIncarnationId: 'incarnation-a'
    })
  })
})
