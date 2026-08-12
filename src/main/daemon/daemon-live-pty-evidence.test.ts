import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectDaemonPtyOwnership } from './daemon-live-pty-evidence'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type { WindowsProcessCandidate } from '../providers/windows-foreground-process-rows'

const { readFreshProcessTable, readCachedProcessTable } = vi.hoisted(() => ({
  readFreshProcessTable: vi.fn(async () => [] as ProcessTableRow[]),
  readCachedProcessTable: vi.fn(async () => [] as ProcessTableRow[])
}))

// Spread the original: the Windows enumerator builds its reader from this module too.
vi.mock('../../shared/process-table-snapshot', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFreshProcessTableSnapshot: readFreshProcessTable,
  getProcessTableSnapshot: readCachedProcessTable
}))

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

  it('ignores helpers the daemon forked, which are not session leaders', async () => {
    // Why this and not re-sampling: a hung `scutil`, credential helper or PTY-spawn health
    // check outlives any sampling gap — often it is *why* the daemon is wedged. Only a PTY
    // child is a session leader (forkpty calls setsid), so the flag is the real discriminator.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'S', command: '/usr/sbin/scutil --dns' }),
          row(102, DAEMON_PID, { stat: 'R+', command: '/bin/sh -c exit 0' })
        ])
      })
    ).resolves.toBe('no-live-ptys')
  })

  it("excludes the daemon's own PTY-spawn probe, which forkpty also makes a session leader", async () => {
    // Why the stat flag is not enough: the daemon opens this PTY itself, so a daemon hosting
    // zero user terminals would be held forever on the strength of its own stuck health check.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'Ss', command: '/bin/sh -c exit 0' })
        ])
      })
    ).resolves.toBe('no-live-ptys')
  })

  it("still counts a real terminal sitting beside the daemon's own probe", async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'Ss', command: '/bin/sh -c exit 0' }),
          row(202, DAEMON_PID, { stat: 'Ss+', command: 'claude' })
        ])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('does not exclude an agent whose command merely contains a probe command', async () => {
    // Exact match, not prefix or substring: `sh -c` payloads are user-supplied, and treating one
    // as the daemon's own probe discards proof that killing the daemon would end real work.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'Ss', command: '/bin/sh -c exit 0 && claude' })
        ])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('counts a session leader reached through a non-session-leader hop', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { stat: 'S', command: 'wrapper' }),
          row(202, 101, { stat: 'Ss+', command: 'claude' })
        ])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('ignores a login wrapper stranded without its shell (#13764)', async () => {
    // Why: the macOS TCC wrapper can outlive the shell it wrapped, leaving a session leader
    // hosting nothing. On hosts where those accumulate, counting them would hold a daemon
    // whose sessions have all ended — indefinitely, and for no live work.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { command: '/usr/bin/login -flpq nwparker /bin/bash …' }),
          row(102, DAEMON_PID, { command: '/usr/bin/login -flpq nwparker /bin/bash …' })
        ])
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('still counts a login wrapper that has its shell', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID, { command: '/usr/bin/login -flpq nwparker /bin/bash …' }),
          row(202, 101, { command: '/opt/homebrew/bin/bash --rcfile …' })
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

  it('falls back to the cached table when the uncached read blows its deadline', async () => {
    // Why this matters most on the busiest host: every agent pane drives the shared reader on
    // its own cadence, so the uncached read queues behind them and can expire on queueing
    // alone — going blind exactly where the daemon has the most agents to lose.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        posixDeadlineMs: 5,
        readPosixProcessTable: () => new Promise<ProcessTableRow[]>(() => {}),
        readCachedPosixProcessTable: posixTable([daemonRow, row(101, DAEMON_PID)])
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('reports unknown only when the cached table is blind too', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        posixDeadlineMs: 5,
        readPosixProcessTable: () => new Promise<ProcessTableRow[]>(() => {}),
        readCachedPosixProcessTable: () => new Promise<ProcessTableRow[]>(() => {})
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

  it('tolerates a ppid cycle reachable from the daemon without hanging', async () => {
    // Why this shape: `ps` is not atomic, so a re-parented process can appear twice and
    // close a loop. The cycle must be reachable from the root or the walk never enters it.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        readPosixProcessTable: posixTable([
          daemonRow,
          row(101, DAEMON_PID),
          row(102, 101),
          row(101, 102)
        ])
      })
    ).resolves.toBe('owns-live-ptys')
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

  it('ignores the conpty warmup processes the daemon spawns for itself', async () => {
    // Casing and padding vary with how the OS recorded the command line, and this branch counts
    // *any* descendant — so without the match a daemon hosting nothing would look occupied.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        queryWindowsDescendants: async () => [
          { ...windowsCandidate(101), command: '  CMD.EXE /C EXIT  ' },
          { ...windowsCandidate(102), command: 'Cmd /C Exit' }
        ]
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('still counts a hosted terminal sitting beside the conpty warmup', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        queryWindowsDescendants: async () => [
          { ...windowsCandidate(101), command: 'cmd.exe /c exit' },
          { ...windowsCandidate(202), command: 'claude' }
        ]
      })
    ).resolves.toBe('owns-live-ptys')
  })

  it('does not exclude a command that merely starts with the warmup command', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        queryWindowsDescendants: async () => [
          { ...windowsCandidate(101), command: 'cmd.exe /c exit && npm run dev' }
        ]
      })
    ).resolves.toBe('owns-live-ptys')
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

  it('gives up as unknown when enumeration blows its deadline', async () => {
    // Why bounded: the CIM query has no budget of its own and can queue behind an in-flight
    // scan, so an unbounded wait would stall the launch path. Blind is safe here; hanging is not.
    const queryWindowsDescendants = vi.fn(() => new Promise<WindowsProcessCandidate[]>(() => {}))

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        windowsDeadlineMs: 5,
        queryWindowsDescendants
      })
    ).resolves.toBe('unknown')
    expect(queryWindowsDescendants).toHaveBeenCalled()
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
  it('takes a conclusive answer on the first read, without re-sampling', async () => {
    const readPosixProcessTable = vi.fn(async () => [daemonRow, row(101, DAEMON_PID)])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', readPosixProcessTable })
    ).resolves.toBe('owns-live-ptys')
    expect(readPosixProcessTable).toHaveBeenCalledTimes(1)
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

describe('inspectDaemonPtyOwnership POSIX process-table source', () => {
  beforeEach(() => {
    readFreshProcessTable.mockReset()
    readCachedProcessTable.mockReset()
    readFreshProcessTable.mockResolvedValue([daemonRow, row(101, DAEMON_PID)])
    readCachedProcessTable.mockResolvedValue([])
  })

  it('reads an uncached table, since the cached one can predate the PTYs it protects', async () => {
    // The 500ms TTL would also hand both samples the same array, collapsing the confirmation.
    await expect(inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin' })).resolves.toBe(
      'owns-live-ptys'
    )
    expect(readFreshProcessTable).toHaveBeenCalled()
    expect(readCachedProcessTable).not.toHaveBeenCalled()
  })
})
