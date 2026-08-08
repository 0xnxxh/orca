import { describe, expect, it } from 'vitest'
import { buildSshTerminalAuthorityAttachRequest } from './ssh-terminal-authority-attach-request'

describe('SSH terminal authority attach request', () => {
  it('publishes authority metadata only with exact durable lease identity', () => {
    expect(
      buildSshTerminalAuthorityAttachRequest({
        paneKey: 'pane-a',
        worktreeId: 'repo::/srv/repo'
      })
    ).toEqual({})
    expect(
      buildSshTerminalAuthorityAttachRequest({
        paneKey: 'pane-a',
        worktreeId: 'repo::/srv/repo',
        ptyIncarnationId: 'incarnation-a'
      })
    ).toEqual({})
  })

  it('includes a renderer generation when the lease recorded one', () => {
    expect(
      buildSshTerminalAuthorityAttachRequest({
        paneKey: 'pane-a',
        worktreeId: 'repo::/srv/repo',
        paneGeneration: 0,
        ptyIncarnationId: 'incarnation-a'
      })
    ).toMatchObject({ expectedPaneGeneration: 0 })
  })
})
