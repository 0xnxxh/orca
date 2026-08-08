import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inspectTerminalAuthorityExecutionScope,
  readOrCreateTerminalAuthorityHostId
} from './terminal-session-authority-host-identity'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('terminal authority host identity', () => {
  it('publishes one complete identity across concurrent first writers', async () => {
    const directory = freshDirectory()
    let nextId = 0
    const ids = await Promise.all(
      Array.from({ length: 20 }, () =>
        readOrCreateTerminalAuthorityHostId(directory, () => `host-${++nextId}`)
      )
    )

    expect(new Set(ids)).toEqual(new Set([ids[0]]))
    await expect(readOrCreateTerminalAuthorityHostId(directory, () => 'late-host')).resolves.toBe(
      ids[0]
    )
  })

  it('ignores an unpublished partial directory from a crashed contender', async () => {
    const directory = freshDirectory()
    const partial = path.join(
      directory,
      `authority-host.json.${process.pid}.00000000-0000-4000-8000-000000000000.tmp`
    )
    mkdirSync(partial)
    writeFileSync(path.join(partial, 'identity.json'), '{"version":1')

    await expect(readOrCreateTerminalAuthorityHostId(directory, () => 'host-a')).resolves.toBe(
      'host-a'
    )
  })

  it.each(['', '{"version":1'])(
    'normalizes an incomplete published record to corruption',
    async (contents) => {
      const directory = freshDirectory()
      writeFileSync(path.join(directory, 'authority-host.json'), contents)

      await expect(readOrCreateTerminalAuthorityHostId(directory)).rejects.toMatchObject({
        code: 'record-corrupt'
      })
    }
  )

  it('binds Linux execution scope to the physical host and PID namespace', async () => {
    const dependencies = {
      readHostIdentity: vi.fn(async () => 'host-a'),
      readBootIdentity: vi.fn(async () => 'boot-a'),
      readLinuxPidNamespace: vi.fn(async () => 'pid:[101]')
    }
    const first = await inspectTerminalAuthorityExecutionScope('linux', dependencies)
    const same = await inspectTerminalAuthorityExecutionScope('linux', dependencies)
    const otherBoot = await inspectTerminalAuthorityExecutionScope('linux', {
      ...dependencies,
      readBootIdentity: async () => 'boot-b'
    })
    const otherNamespace = await inspectTerminalAuthorityExecutionScope('linux', {
      ...dependencies,
      readLinuxPidNamespace: async () => 'pid:[202]'
    })
    const otherHost = await inspectTerminalAuthorityExecutionScope('linux', {
      ...dependencies,
      readHostIdentity: async () => 'host-b'
    })

    expect(first).toEqual({
      executionScope: expect.stringMatching(/^terminal-authority-execution-v1:linux:/),
      bootId: 'boot-a',
      linuxPidNamespace: 'pid:[101]'
    })
    expect(same).toEqual(first)
    expect(otherBoot.executionScope).toBe(first.executionScope)
    expect(otherBoot.bootId).toBe('boot-b')
    expect(otherNamespace.executionScope).not.toBe(first.executionScope)
    expect(otherHost.executionScope).not.toBe(first.executionScope)
    expect(dependencies.readLinuxPidNamespace).toHaveBeenCalledWith('self')
  })

  it('uses the proven macOS host identity as its global process namespace', async () => {
    const first = await inspectTerminalAuthorityExecutionScope('darwin', {
      readHostIdentity: async () => 'host-a'
    })
    const otherHost = await inspectTerminalAuthorityExecutionScope('darwin', {
      readHostIdentity: async () => 'host-b'
    })

    expect(first.executionScope).toMatch(/^terminal-authority-execution-v1:darwin:/)
    expect(otherHost.executionScope).not.toBe(first.executionScope)
  })

  it('uses a proven Windows host identity for its global process namespace', async () => {
    const first = await inspectTerminalAuthorityExecutionScope('win32', {
      readHostIdentity: async () => 'win32-machine:machine-a'
    })
    const otherHost = await inspectTerminalAuthorityExecutionScope('win32', {
      readHostIdentity: async () => 'win32-machine:machine-b'
    })
    const runtimeFallback = await inspectTerminalAuthorityExecutionScope('win32', {
      readHostIdentity: async () => 'runtime:unproven'
    })

    expect(first.executionScope).toMatch(/^terminal-authority-execution-v1:win32:/)
    expect(otherHost.executionScope).not.toBe(first.executionScope)
    expect(runtimeFallback).toEqual({})
  })

  it('never constructs a Linux scope without host or namespace evidence', async () => {
    const complete = {
      readHostIdentity: async (): Promise<string | undefined> => 'host-a',
      readBootIdentity: async (): Promise<string | undefined> => 'boot-a',
      readLinuxPidNamespace: async (): Promise<string | undefined> => 'pid:[101]'
    }
    const scopes = await Promise.all([
      inspectTerminalAuthorityExecutionScope('linux', {
        ...complete,
        readHostIdentity: async () => undefined
      }),
      inspectTerminalAuthorityExecutionScope('linux', {
        ...complete,
        readLinuxPidNamespace: async () => undefined
      })
    ])

    expect(scopes.every((scope) => scope.executionScope === undefined)).toBe(true)
  })

  it.each(['linux', 'darwin', 'win32'] as const)(
    'keeps an unreadable %s execution scope unknown',
    async (platform) => {
      const unreadable = async (): Promise<string> => {
        throw new Error('scope unavailable')
      }

      await expect(
        inspectTerminalAuthorityExecutionScope(platform, {
          readBootIdentity: unreadable,
          readHostIdentity: unreadable,
          readLinuxPidNamespace: unreadable
        })
      ).resolves.toEqual({})
    }
  )
})

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-host-identity-'))
  directories.push(directory)
  return directory
}
