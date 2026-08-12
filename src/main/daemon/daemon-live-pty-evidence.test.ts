import { describe, expect, it, vi } from 'vitest'
import { inspectDaemonPtyOwnership } from './daemon-live-pty-evidence'
import type { DescendantSnapshot, ProcessTableRow } from '../pty-descendant-termination'
import type { WindowsProcessCandidate } from '../providers/windows-foreground-process-rows'

const DAEMON_PID = 4242

function posixRow(pid: number): ProcessTableRow {
  return { pid, ppid: DAEMON_PID, pgid: pid, startedAt: 'Mon Jul 13 12:54:47 2026' }
}

function posixSnapshot(overrides: Partial<DescendantSnapshot> = {}): DescendantSnapshot {
  return { rootPgid: DAEMON_PID, descendants: [], capturedAtMs: 1_700_000_000_000, ...overrides }
}

function windowsCandidate(pid: number): WindowsProcessCandidate {
  return { pid, ppid: DAEMON_PID, name: 'bash.exe', command: 'bash', executablePath: '', depth: 1 }
}

describe('inspectDaemonPtyOwnership on POSIX', () => {
  it.each(['darwin', 'linux'] as const)(
    'reports live PTY ownership from descendants on %s',
    async (platform) => {
      const capturePosixDescendants = vi.fn(
        async (_pid: number, _deps?: { platform?: NodeJS.Platform; timeoutMs?: number }) =>
          posixSnapshot({ descendants: [posixRow(101), posixRow(102)] })
      )

      await expect(
        inspectDaemonPtyOwnership(DAEMON_PID, { platform, capturePosixDescendants })
      ).resolves.toBe('owns-live-ptys')
      // The walk must run on the caller's platform, not the host's, and with a budget
      // generous enough to survive the load that wedged the daemon in the first place.
      expect(capturePosixDescendants.mock.calls[0]?.[1]).toMatchObject({ platform })
      expect(capturePosixDescendants.mock.calls[0]?.[1]?.timeoutMs ?? 0).toBeGreaterThanOrEqual(
        5_000
      )
    }
  )

  it('reports no live PTYs only when the root itself was observed', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        capturePosixDescendants: async () => posixSnapshot({ rootPgid: DAEMON_PID })
      })
    ).resolves.toBe('no-live-ptys')
  })

  it('reports unknown when the walk never saw the root, despite zero descendants', async () => {
    // Why: an unobserved root yields the same empty list as a childless one —
    // reading that as "empty" authorizes killing a daemon full of live agents.
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        capturePosixDescendants: async () => posixSnapshot({ rootPgid: null })
      })
    ).resolves.toBe('unknown')
  })

  it('reports unknown when the process table could not be read', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        capturePosixDescendants: async () => null
      })
    ).resolves.toBe('unknown')
  })

  it('reports unknown when the capture throws', async () => {
    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        capturePosixDescendants: async () => {
          throw new Error('ps timed out')
        }
      })
    ).resolves.toBe('unknown')
  })

  it('never consults the Windows enumerator on POSIX', async () => {
    const queryWindowsDescendants = vi.fn(async () => [windowsCandidate(101)])

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'darwin',
        capturePosixDescendants: async () => posixSnapshot(),
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

  it('never consults the POSIX walk on win32', async () => {
    const capturePosixDescendants = vi.fn(async () => posixSnapshot())

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, {
        platform: 'win32',
        capturePosixDescendants,
        queryWindowsDescendants: async () => null
      })
    ).resolves.toBe('unknown')
    expect(capturePosixDescendants).not.toHaveBeenCalled()
  })
})

describe('inspectDaemonPtyOwnership retries', () => {
  it('retries a blind probe, because the load that wedges the daemon also blinds ps', async () => {
    const capturePosixDescendants = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(posixSnapshot({ descendants: [posixRow(101)] }))

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', capturePosixDescendants })
    ).resolves.toBe('owns-live-ptys')
    expect(capturePosixDescendants).toHaveBeenCalledTimes(2)
  })

  it('stops retrying once the answer is conclusive', async () => {
    const capturePosixDescendants = vi.fn(async () => posixSnapshot({ rootPgid: DAEMON_PID }))

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', capturePosixDescendants })
    ).resolves.toBe('no-live-ptys')
    expect(capturePosixDescendants).toHaveBeenCalledTimes(1)
  })

  it('gives up as unknown rather than guessing when every probe stays blind', async () => {
    const capturePosixDescendants = vi.fn(async () => null)

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', capturePosixDescendants })
    ).resolves.toBe('unknown')
    expect(capturePosixDescendants.mock.calls.length).toBeGreaterThan(1)
  })

  it('retries a throwing probe too', async () => {
    const capturePosixDescendants = vi
      .fn()
      .mockRejectedValueOnce(new Error('ps died'))
      .mockResolvedValueOnce(posixSnapshot({ descendants: [posixRow(101)] }))

    await expect(
      inspectDaemonPtyOwnership(DAEMON_PID, { platform: 'darwin', capturePosixDescendants })
    ).resolves.toBe('owns-live-ptys')
  })
})
