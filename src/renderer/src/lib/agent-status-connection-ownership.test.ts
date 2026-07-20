import { describe, expect, it } from 'vitest'

import { toAppSshPtyId } from '../../../shared/ssh-pty-id'
import { makePaneKey } from '../../../shared/stable-pane-id'
import {
  isAgentStatusPanePtyBindingCurrent,
  isAgentStatusPtyLiveForPane,
  resolveAgentStatusConnectionRouting
} from './agent-status-connection-ownership'

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE = makePaneKey('tab-1', LEAF)

describe('agent status connection ownership', () => {
  it('uses exact SSH PTY ownership and rejects contradictory routing', () => {
    const ptyId = toAppSshPtyId('ssh-a', 'pty-1')

    expect(resolveAgentStatusConnectionRouting({ ptyId, expectedConnectionId: 'ssh-a' })).toEqual({
      connectionId: 'ssh-a'
    })
    expect(
      resolveAgentStatusConnectionRouting({ ptyId, expectedConnectionId: 'ssh-b' })
    ).toBeUndefined()
    expect(
      resolveAgentStatusConnectionRouting({ ptyId, expectedConnectionId: null })
    ).toBeUndefined()
    expect(resolveAgentStatusConnectionRouting({ ptyId: 'ssh:ssh-a@broken' })).toBeUndefined()
  })

  it('marks known local, WSL, and remote-runtime PTYs as non-SSH', () => {
    expect(
      resolveAgentStatusConnectionRouting({ ptyId: 'pty-local-1', expectedConnectionId: null })
    ).toEqual({ connectionId: null })
    expect(
      resolveAgentStatusConnectionRouting({ ptyId: 'pty-wsl-1', expectedConnectionId: null })
    ).toEqual({ connectionId: null })
    expect(
      resolveAgentStatusConnectionRouting({
        ptyId: 'remote:env-a@@terminal-1',
        expectedConnectionId: null,
        runtimeEnvironmentId: 'env-a'
      })
    ).toEqual({ connectionId: null })
  })

  it('fails closed for missing, malformed, and cross-runtime ownership', () => {
    expect(resolveAgentStatusConnectionRouting({ ptyId: null })).toBeUndefined()
    expect(resolveAgentStatusConnectionRouting({ ptyId: 'remote:' })).toBeUndefined()
    expect(
      resolveAgentStatusConnectionRouting({
        ptyId: 'remote:env-a@@terminal-1',
        expectedConnectionId: 'ssh-a',
        runtimeEnvironmentId: 'env-a'
      })
    ).toBeUndefined()
    expect(
      resolveAgentStatusConnectionRouting({
        ptyId: 'remote:env-a@@terminal-1',
        expectedConnectionId: null,
        runtimeEnvironmentId: 'env-b'
      })
    ).toBeUndefined()
  })

  it('requires the exact pane-to-PTY binding', () => {
    const layouts = {
      'tab-1': { ptyIdsByLeafId: { [LEAF]: toAppSshPtyId('ssh-a', 'pty-1') } }
    }

    expect(
      isAgentStatusPanePtyBindingCurrent(layouts, PANE, layouts['tab-1'].ptyIdsByLeafId[LEAF])
    ).toBe(true)
    expect(isAgentStatusPanePtyBindingCurrent(layouts, PANE, toAppSshPtyId('ssh-b', 'pty-1'))).toBe(
      false
    )
  })

  it('requires the exact PTY to remain live for the pane tab', () => {
    const ptyId = toAppSshPtyId('ssh-a', 'pty-1')

    expect(isAgentStatusPtyLiveForPane({ 'tab-1': [ptyId] }, PANE, ptyId)).toBe(true)
    expect(isAgentStatusPtyLiveForPane({ 'tab-1': [] }, PANE, ptyId)).toBe(false)
    expect(isAgentStatusPtyLiveForPane({ 'tab-2': [ptyId] }, PANE, ptyId)).toBe(false)
  })
})
