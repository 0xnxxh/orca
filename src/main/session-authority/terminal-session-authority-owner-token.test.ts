import { describe, expect, it } from 'vitest'
import {
  encodeTerminalAuthorityOwnerToken,
  parseTerminalAuthorityOwnerToken
} from './terminal-session-authority-owner-token'

const OWNER_NONCE = '00000000-0000-4000-8000-000000000001'
const OWNER_INCARNATION = '00000000-0000-4000-8000-000000000002'

describe('terminal authority owner token', () => {
  it('round-trips a complete Linux execution identity', () => {
    const encoded = encodeTerminalAuthorityOwnerToken(OWNER_NONCE, {
      ownerIncarnationId: OWNER_INCARNATION,
      process: {
        pid: 1,
        platform: 'linux',
        bootId: 'boot-a',
        linuxStartTicks: '100',
        linuxPidNamespace: 'pid:[101]',
        executionScope: 'host-a'
      }
    })

    expect(parseTerminalAuthorityOwnerToken(encoded)?.process).toEqual({
      pid: 1,
      platform: 'linux',
      bootId: 'boot-a',
      linuxStartTicks: '100',
      linuxPidNamespace: 'pid:[101]',
      executionScope: 'host-a'
    })
  })

  it('keeps older Linux tokens parseable without granting namespace proof', () => {
    const encoded = encodeTerminalAuthorityOwnerToken(OWNER_NONCE, {
      ownerIncarnationId: OWNER_INCARNATION,
      process: {
        pid: 1,
        platform: 'linux',
        bootId: 'boot-a',
        linuxStartTicks: '100'
      }
    })

    expect(parseTerminalAuthorityOwnerToken(encoded)?.process).toEqual({
      pid: 1,
      platform: 'linux',
      bootId: 'boot-a',
      linuxStartTicks: '100'
    })
  })

  it('rejects a PID namespace without the matching Linux boot/start identity', () => {
    expect(() =>
      encodeTerminalAuthorityOwnerToken(OWNER_NONCE, {
        ownerIncarnationId: OWNER_INCARNATION,
        process: { pid: 1, platform: 'linux', linuxPidNamespace: 'pid:[101]' }
      })
    ).toThrow('namespace identity is incomplete')
  })
})
