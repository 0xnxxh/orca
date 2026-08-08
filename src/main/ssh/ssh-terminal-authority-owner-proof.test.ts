import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshConnection } from './ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { proveSshTerminalAuthorityOwner } from './ssh-terminal-authority-discovery'

vi.mock('./ssh-relay-deploy-helpers', () => ({ execCommand: vi.fn() }))

const conn = {} as SshConnection
const darwin = getRemoteHostPlatform('darwin-arm64')
const marker = { ownerPid: 42, ownerProcessToken: 'owner-process-token' } as const

describe('SSH terminal authority owner proof', () => {
  beforeEach(() => {
    vi.mocked(execCommand).mockReset()
  })

  it('maps command failure to explicit inspection failure', async () => {
    vi.mocked(execCommand).mockRejectedValueOnce(new Error('process inspection unavailable'))

    await expect(proveSshTerminalAuthorityOwner(conn, darwin, marker)).resolves.toBe(
      'inspection-failed'
    )
  })

  it.each(['', 'malformed output', 'OWNER_UNKNOWN\n'])(
    'rejects unusable proof output %j',
    async (output) => {
      vi.mocked(execCommand).mockResolvedValueOnce(output)

      await expect(proveSshTerminalAuthorityOwner(conn, darwin, marker)).resolves.toBe(
        'inspection-failed'
      )
    }
  )

  it.each([
    ['OWNER_ALIVE\n', 'owner-alive'],
    ['OWNER_GONE\n', 'owner-gone']
  ] as const)('accepts exact proof output %j', async (output, expected) => {
    vi.mocked(execCommand).mockResolvedValueOnce(output)

    await expect(proveSshTerminalAuthorityOwner(conn, darwin, marker)).resolves.toBe(expected)
  })
})
