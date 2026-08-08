import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

vi.mock('./ssh-relay-deploy-helpers', () => ({
  execCommand: vi.fn()
}))

vi.mock('./ssh-connection-utils', () => ({
  shellEscape: (value: string) => `'${value}'`
}))

import { execCommand } from './ssh-relay-deploy-helpers'
import type { SshConnection } from './ssh-connection'
import { gcOldRelayVersions } from './ssh-relay-versioned-install'

const conn = {} as SshConnection
const mockExec = vi.mocked(execCommand)

describe('terminal authority relay GC protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never collects the relay directory named by the terminal authority', async () => {
    mockExec.mockResolvedValueOnce('relay-0.1.0+aaa\nrelay-0.1.0+ccc\n')
    mockExec
      .mockResolvedValueOnce('OPEN')
      .mockResolvedValueOnce('COMPLETE')
      .mockResolvedValueOnce('ALIVE')

    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+bbb', undefined, {
      protectedRelayDir: '/home/u/.orca-remote/relay-0.1.0+aaa'
    })

    const commands = mockExec.mock.calls.map(([, command]) => command)
    expect(commands.some((command) => command.includes('relay-0.1.0+aaa/.install'))).toBe(false)
    expect(commands.some((command) => command.includes('relay-0.1.0+ccc/.install'))).toBe(true)
  })

  it('never collects imported or unresolved legacy relay directories', async () => {
    mockExec.mockResolvedValueOnce(
      'relay-0.1.0+aaa\nrelay-0.1.0+bbb\nrelay-0.1.0+ccc\nrelay-0.1.0+ddd\n'
    )
    mockExec
      .mockResolvedValueOnce('OPEN')
      .mockResolvedValueOnce('COMPLETE')
      .mockResolvedValueOnce('ALIVE')

    await gcOldRelayVersions(conn, '/home/u', '/home/u/.orca-remote/relay-0.1.0+ddd', undefined, {
      protectedRelayDirs: [
        '/home/u/.orca-remote/relay-0.1.0+aaa',
        '/home/u/.orca-remote/relay-0.1.0+bbb'
      ]
    })

    const commands = mockExec.mock.calls.map(([, command]) => command)
    expect(commands.some((command) => command.includes('relay-0.1.0+aaa/.install'))).toBe(false)
    expect(commands.some((command) => command.includes('relay-0.1.0+bbb/.install'))).toBe(false)
    expect(commands.some((command) => command.includes('relay-0.1.0+ccc/.install'))).toBe(true)
  })
})
