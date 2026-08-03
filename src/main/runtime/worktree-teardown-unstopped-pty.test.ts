import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listRegisteredPtysMock } = vi.hoisted(() => ({
  listRegisteredPtysMock: vi.fn()
}))

vi.mock('../memory/pty-registry', () => ({
  listRegisteredPtys: listRegisteredPtysMock
}))

import { killAllProcessesForWorktree } from './worktree-teardown'
import { WORKTREE_TEARDOWN_VERIFY_GRACE_MS } from './unstopped-pty-verification'
import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

function createProviderStub(listProcesses: () => Promise<PtyProcessInfo[]>): IPtyProvider {
  return {
    shutdown: vi.fn().mockResolvedValue(undefined),
    listProcesses: vi.fn(listProcesses),
    onData: vi.fn().mockReturnValue(() => {}),
    onReplay: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn().mockReturnValue(() => {})
  } as unknown as IPtyProvider
}

// A worktree whose PTY teardown cannot be proven must still be removable: the
// gate that blocks Git work is the same one that made #11960 permanent.
describe('destructive teardown when a PTY stop cannot be proven', () => {
  beforeEach(() => {
    listRegisteredPtysMock.mockReset()
  })

  // Why (#11960): the sweeps routinely burn the whole budget, so re-listing on
  // the same exhausted deadline returned "unverifiable" for a PTY that had in
  // fact exited — wedging the workspace on every retry.
  it('verifies a failed stop against a fresh budget when the sweeps spent the deadline', async () => {
    vi.useFakeTimers()
    try {
      const localProvider = createProviderStub(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 90))
      )
      ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Session not found: stale-1')
      )
      listRegisteredPtysMock.mockReturnValue([
        { ptyId: 'stale-1', worktreeId: 'w1', sessionId: null, paneKey: null, pid: 100 }
      ])

      const teardown = killAllProcessesForWorktree('w1', {
        localProvider,
        timeoutMs: 100,
        requirePhysicalStop: true
      })
      await vi.advanceTimersByTimeAsync(WORKTREE_TEARDOWN_VERIFY_GRACE_MS + 200)

      await expect(teardown).resolves.toEqual({
        runtimeStopped: 0,
        providerStopped: 0,
        registryStopped: 0
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the blocking PTYs and the escape hatch when one is still live', async () => {
    const localProvider = createProviderStub(async () => [
      { id: 'w1@@live-1', cwd: '/tmp/w1', title: 'shell' }
    ])
    ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('kill failed')
    )
    listRegisteredPtysMock.mockReturnValue([])

    await expect(
      killAllProcessesForWorktree('w1', { localProvider, requirePhysicalStop: true })
    ).rejects.toThrow(/w1@@live-1[\s\S]*--force/)
  })

  it('reports unverifiable separately from live when the process list fails', async () => {
    const localProvider = createProviderStub(async () => {
      throw new Error('daemon socket closed')
    })
    listRegisteredPtysMock.mockReturnValue([
      { ptyId: 'stale-1', worktreeId: 'w1', sessionId: null, paneKey: null, pid: 100 }
    ])
    ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Session not found: stale-1')
    )

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        includeProviderInventory: false,
        requirePhysicalStop: true
      })
    ).rejects.toThrow(/could not verify[\s\S]*stale-1[\s\S]*daemon socket closed/)
  })

  it('lets an explicit force removal proceed past PTYs it could not stop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const localProvider = createProviderStub(async () => [
        { id: 'w1@@live-1', cwd: '/tmp/w1', title: 'shell' }
      ])
      ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('kill failed')
      )
      listRegisteredPtysMock.mockReturnValue([])
      const onPtyStopped = vi.fn()

      await expect(
        killAllProcessesForWorktree('w1', {
          localProvider,
          onPtyStopped,
          requirePhysicalStop: true,
          allowUnverifiedStop: true
        })
      ).resolves.toMatchObject({ providerStopped: 0 })
      expect(onPtyStopped).toHaveBeenCalledWith('w1@@live-1')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('w1@@live-1'))
    } finally {
      warn.mockRestore()
    }
  })
})
