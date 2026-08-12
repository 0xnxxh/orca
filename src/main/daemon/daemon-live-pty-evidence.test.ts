import { describe, expect, it, vi } from 'vitest'
import { inspectDaemonPtyOwnership } from './daemon-live-pty-evidence'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type { WindowsProcessCandidate } from '../providers/windows-foreground-process-rows'

const DAEMON_PID = 4242

function row(pid: number, ppid: number, overrides: Partial<ProcessTableRow> = {}): ProcessTableRow {
  return { pid, ppid, stat: 'Ss', command: '/bin/bash', ...overrides }
}

const daemonRow = row(DAEMON_PID, 1, { command: 'daemon-entry.js' })

function windowsCandidate(pid: number): WindowsProcessCandidate {
  return { pid, ppid: DAEMON_PID, name: 'bash.exe', command: 'bash', executablePath: '', depth: 1 }
}

function posixTable(rows: ProcessTableRow[]): () => Promise<ProcessTableRow[]> {
  return async () => rows
}

describe('inspectDaemonPtyOwnership on POSIX', () => {
  it.each(['darwin', 'linux'] as const)('reports live PTY ownership on %s', async (platform) => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform,
        readPosixProcessTable: posixTable([daemonRow, row(101, DAEMON_PID)])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('counts a grandchild, since macOS wraps every shell in login(1)', async () => {
    // daemon -> login(1) -> shell: a direct-children test would miss the agent entirely.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { command: '/usr/bin/login -flpq nwparker' }),
          row(202, 101, { command: 'claude' })
        ])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('reports no live PTYs for an observed root with no descendants', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([daemonRow, row(999, 1)])
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('does not count zombies, which a wedged daemon cannot reap', async () => {
    // Why this matters: the daemon is wedged precisely because its event loop is blocked,
    // so every already-exited agent lingers as <defunct>. Counting them would read
    // "all agents finished" as "agents still running" — correlated with the wedge itself.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'Z+', command: '<defunct>' }),
          row(102, DAEMON_PID, { stat: 'Z', command: '<defunct>' })
        ])
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('still counts a live descendant hidden behind a zombie parent', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'Z', command: '<defunct>' }),
          row(202, 101, { command: 'codex' })
        ])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('reports unknown when the table never contained the daemon', async () => {
    // Why: an unobserved root yields the same empty result as a childless one —
    // reading that as "empty" authorizes killing a daemon full of live agents.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([row(999, 1)])
      })
    ).resolves.toBe('unknown')
  })

  it('reports unknown when the process table cannot be read', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: async () => {
          throw new Error('ps timed out')
        }
      })
    ).resolves.toBe('unknown')
  })

  it('tolerates a ppid cycle without hanging', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([daemonRow, row(101, 102), row(102, 101)])
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('never consults the Windows enumerator on POSIX', async () => {
    const queryWindowsDescendants = vi.fn(async () => [windowsCandidate(101)])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([daemonRow]),
        queryWindowsDescendants
      })
    ).resolves.toBe('no-live-ptys')
    expect(queryWindowsDescendants).not.toHaveBeenCalled()
  })
})

describe('inspectDaemonPtyOwnership on win32', () => {
  it('reports live PTY ownership from a non-empty descendant list', async () => {
    const queryWindowsDescendants = vi.fn(async () => [windowsCandidate(101)])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'win32', queryWindowsDescendants })
    ).resolves.toBe('owns-live-ptys')
    // Why: a cached table can predate the very PTYs this decision protects.
    expect(queryWindowsDescendants).toHaveBeenCalledWith(DAEMON_PID, { fresh: true })
  })

  it('reports no live PTYs for an observed root with an empty descendant list', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        queryWindowsDescendants: async () => []
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('reports unknown when enumeration failed or the root was absent', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        queryWindowsDescendants: async () => null
      })
    ).resolves.toBe('unknown')
  })

  it('reports unknown when the enumerator throws', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        queryWindowsDescendants: async () => {
          throw new Error('powershell unavailable')
        }
      })
    ).resolves.toBe('unknown')
  })

  it('never consults the POSIX table on win32', async () => {
    const readPosixProcessTable = vi.fn(async () => [daemonRow])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        readPosixProcessTable,
        queryWindowsDescendants: async () => null
      })
    ).resolves.toBe('unknown')
    expect(readPosixProcessTable).not.toHaveBeenCalled()
  })
})

describe('inspectDaemonPtyOwnership sampling', () => {
  it('discards a transient child that is gone by the second sample', async () => {
    // A resolver probe or PTY-spawn health check is a descendant for milliseconds; it must
    // not read as an agent and strand the daemon in degraded mode.
    const readPosixProcessTable = vi
      .fn<() => Promise<ProcessTableRow[]>>()
      .mockResolvedValueOnce([daemonRow, row(101, DAEMON_PID, { command: 'scutil --dns' })])
      .mockResolvedValueOnce([daemonRow])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', readPosixProcessTable })
    ).resolves.toBe('no-live-ptys')
    expect(readPosixProcessTable).toHaveBeenCalledTimes(2)
  })

  it('retries a blind read, because the load that wedges the daemon also blinds ps', async () => {
    const readPosixProcessTable = vi
      .fn<() => Promise<ProcessTableRow[]>>()
      .mockRejectedValueOnce(new Error('ps timed out'))
      .mockResolvedValueOnce([daemonRow, row(101, DAEMON_PID)])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', readPosixProcessTable })
    ).resolves.toBe('owns-live-ptys')
  })

  it('preserves on a sighting the second read could not contradict', async () => {
    // Why: a blind read is not evidence against a live one. Killing agents is unrecoverable.
    const readPosixProcessTable = vi
      .fn<() => Promise<ProcessTableRow[]>>()
      .mockResolvedValueOnce([daemonRow, row(101, DAEMON_PID)])
      .mockRejectedValueOnce(new Error('ps timed out'))

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', readPosixProcessTable })
    ).resolves.toBe('owns-live-ptys')
  })

  it('answers no-live-ptys on the first conclusive read without re-sampling', async () => {
    const readPosixProcessTable = vi.fn(async () => [daemonRow])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', readPosixProcessTable })
    ).resolves.toBe('no-live-ptys')
    expect(readPosixProcessTable).toHaveBeenCalledTimes(1)
  })

  it('gives up as unknown rather than guessing when every read stays blind', async () => {
    const readPosixProcessTable = vi.fn(async (): Promise<ProcessTableRow[]> => {
      throw new Error('ps timed out')
    })

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', readPosixProcessTable })
    ).resolves.toBe('unknown')
    expect(readPosixProcessTable.mock.calls.length).toBeGreaterThan(1)
  })
})
