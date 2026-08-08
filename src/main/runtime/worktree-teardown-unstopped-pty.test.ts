import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listRegisteredPtysMock } = vi.hoisted(() => ({
  listRegisteredPtysMock: vi.fn()
}))

vi.mock('../memory/pty-registry', () => ({
  listRegisteredPtys: listRegisteredPtysMock
}))

import { killAllProcessesForWorktree, WORKTREE_PROCESS_SWEEP_TIMEOUT_MS } from './worktree-teardown'
import { ABANDONED_SWEEP_GRACE_MS } from './forced-sweep-settlement'
import {
  classifyWorktreeForceDeleteReason,
  isProvenLivePtyRemovalError
} from '../../shared/worktree-removal'
import type { PtyProcessInfo } from '../providers/types'
import { createWorktreeTeardownProviderStub as createProviderStub } from './__tests__/worktree-teardown-provider'

// Why: these tests advance fake timers *before* awaiting the teardown, so a
// rejection mid-advance had no handler yet — Node reported it as an unhandled
// rejection and vitest surfaced it inside whichever test happened to be running.
// Attaching a no-op handler at creation keeps the original semantics while
// making failures land as clean assertion failures in their own test.
function settleTeardown<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined)
  return promise
}

// A worktree whose PTY teardown cannot be proven must still be removable: the
// gate that blocks Git work is the same one that made #11960 permanent.
describe('destructive teardown when a PTY stop cannot be proven', () => {
  beforeEach(() => {
    listRegisteredPtysMock.mockReset()
  })

  it('does not turn a late empty inventory into exit proof', async () => {
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

      const teardown = settleTeardown(
        killAllProcessesForWorktree('w1', {
          localProvider,
          timeoutMs: 100,
          requirePhysicalStop: true
        })
      )
      await vi.runAllTimersAsync()

      await expect(teardown).rejects.toThrow(/worktree_pty_inventory_missing:stale-1/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires force when only an empty inventory suggests a PTY exited', async () => {
    const worktreeId = 'repo-1::C:/Users/admin/orca/workspaces/repo/auto-review-run-28'
    // Slow enough that a fixed 2s grace could not absorb it, but far enough from
    // the budget that the list-completion and timeout timers can't land in the
    // same tick — a 100ms margin here raced under parallel load.
    const listDelayMs = WORKTREE_PROCESS_SWEEP_TIMEOUT_MS / 2
    vi.useFakeTimers()
    try {
      const localProvider = createProviderStub(
        () => new Promise((resolve) => setTimeout(() => resolve([]), listDelayMs))
      )
      ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Session not found: term_abab11ee')
      )
      listRegisteredPtysMock.mockReturnValue([
        { ptyId: 'term_abab11ee', worktreeId, sessionId: null, paneKey: null, pid: 4242 }
      ])

      const teardown = settleTeardown(
        killAllProcessesForWorktree(worktreeId, {
          localProvider,
          requirePhysicalStop: true
        })
      )
      await vi.runAllTimersAsync()

      await expect(teardown).rejects.toThrow(/worktree_pty_inventory_missing:term_abab11ee/)
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
    ).rejects.toThrow(/still live: w1@@live-1[\s\S]*--force/)
  })

  it('preserves PTY state when inventory omission is the only exit evidence', async () => {
    const localProvider = createProviderStub(async () => [])
    ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Session not found: stale-1')
    )
    listRegisteredPtysMock.mockReturnValue([
      { ptyId: 'stale-1', worktreeId: 'w1', sessionId: null, paneKey: null, pid: 100 }
    ])
    const onPtyStopped = vi.fn()

    await expect(
      killAllProcessesForWorktree('w1', {
        localProvider,
        onPtyStopped,
        requirePhysicalStop: true
      })
    ).rejects.toThrow(/worktree_pty_inventory_missing:stale-1/)
    expect(onPtyStopped).not.toHaveBeenCalled()
  })

  it('reports an inventory-missing registry PTY as unknown instead of exited', async () => {
    const localProvider = createProviderStub(async () => [
      { id: 'w1@@live-1', cwd: '/tmp/w1', title: 'shell' }
    ])
    ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('kill failed')
    )
    listRegisteredPtysMock.mockReturnValue([
      { ptyId: 'w1@@gone-2', worktreeId: 'w1', sessionId: null, paneKey: null, pid: 101 }
    ])

    const error = await killAllProcessesForWorktree('w1', {
      localProvider,
      requirePhysicalStop: true
    }).then(
      () => new Error('expected a rejection'),
      (rejection: Error) => rejection
    )
    expect(error.message).toContain('worktree_pty_inventory_missing:w1@@gone-2')
  })

  it('fails destructive teardown at the inventory fence when the process list fails', async () => {
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
    ).rejects.toThrow(/terminal sweep failed: daemon socket closed[\s\S]*--force/)
    expect(localProvider.shutdown).not.toHaveBeenCalled()
  })

  // A gate that force cannot cross is the bug, wherever it sits. These two cover
  // the sweep-level failures that reject before the unproven-stop gate is reached.
  it('lets force through a provider whose inventory rejects outright', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      listRegisteredPtysMock.mockReturnValue([])
      const localProvider = createProviderStub(async () => {
        throw new Error('ssh channel closed')
      })

      await expect(
        killAllProcessesForWorktree('w1', {
          localProvider,
          requirePhysicalStop: true,
          allowUnverifiedStop: true
        })
      ).resolves.toEqual({ runtimeStopped: 0, providerStopped: 0, registryStopped: 0 })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ssh channel closed'))
    } finally {
      warn.mockRestore()
    }
  })

  it('lets force through a sweep that never settles before the deadline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    // Why: hand the stub a resolver instead of a permanently dangling promise, so
    // this test leaves no in-flight continuation to interleave into a later one.
    let releaseList: (sessions: PtyProcessInfo[]) => void = () => {}
    try {
      listRegisteredPtysMock.mockReturnValue([])
      const localProvider = createProviderStub(
        () =>
          new Promise<PtyProcessInfo[]>((resolve) => {
            releaseList = resolve
          })
      )

      const teardown = settleTeardown(
        killAllProcessesForWorktree('w1', {
          localProvider,
          timeoutMs: 100,
          requirePhysicalStop: true,
          allowUnverifiedStop: true
        })
      )
      await vi.runAllTimersAsync()

      await expect(teardown).resolves.toEqual({
        runtimeStopped: 0,
        providerStopped: 0,
        registryStopped: 0
      })
      // Why: the deadline gave up on this sweep without cancelling it, so the grace
      // expired with the provider still inside listProcesses. Force deletes the
      // directory anyway, and this warning is the only record that a PTY handle may
      // have outlived it — a silent "incomplete sweep" reads as if it had finished.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`still running after the ${ABANDONED_SWEEP_GRACE_MS}ms grace`)
      )
    } finally {
      releaseList([])
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  // Why: the caller deletes files the moment this resolves. Returning while another
  // sweep is still inside shutdown() would race the delete against a PTY that was
  // about to release its handles — EBUSY for a process ~300ms from exiting.
  it('waits for in-flight sweeps before force returns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const localProvider = createProviderStub(async () => [
        { id: 'reg-1', cwd: '/tmp/w1', title: 'shell', worktreeId: 'w1' }
      ])
      let shutdownFinished = false
      ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          shutdownFinished = true
        }
      )
      listRegisteredPtysMock.mockReturnValue([
        { ptyId: 'reg-1', worktreeId: 'w1', sessionId: null, paneKey: null, pid: 100 }
      ])

      const result = await killAllProcessesForWorktree('w1', {
        localProvider,
        includeProviderInventory: false,
        requirePhysicalStop: true,
        allowUnverifiedStop: true
      })

      expect(shutdownFinished).toBe(true)
      // And the surviving sweep's work is reported, not flattened to zero.
      expect(result.registryStopped).toBe(1)
    } finally {
      warn.mockRestore()
    }
  })

  // Why: the deadline sentinel only says *something* timed out. Picking the
  // rejection by array position let a hung runtime sweep mask the provider error
  // that actually explains the failure, in the log the user is left with.
  it('warns with the specific sweep failure, not the generic deadline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      listRegisteredPtysMock.mockReturnValue([])
      const localProvider = createProviderStub(async () => {
        throw new Error('ssh channel closed')
      })
      const runtime = {
        stopTerminalsForWorktree: () => new Promise(() => {})
      } as unknown as Parameters<typeof killAllProcessesForWorktree>[1]['runtime']

      const teardown = settleTeardown(
        killAllProcessesForWorktree('w1', {
          runtime,
          localProvider,
          timeoutMs: 100,
          requirePhysicalStop: true,
          allowUnverifiedStop: true
        })
      )
      await vi.runAllTimersAsync()
      await teardown

      const warning = warn.mock.calls.at(-1)?.[0] as string
      expect(warning).toContain('ssh channel closed')
      // Both are reported — losing the timeout would trade one blind spot for
      // another — but the specific cause must lead, not be buried behind it.
      expect(warning).toContain('Timed out waiting')
      expect(warning.indexOf('ssh channel closed')).toBeLessThan(
        warning.indexOf('Timed out waiting')
      )
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })

  it('still fails closed on a sweep-level failure without force', async () => {
    listRegisteredPtysMock.mockReturnValue([])
    const localProvider = createProviderStub(async () => {
      throw new Error('ssh channel closed')
    })

    await expect(
      killAllProcessesForWorktree('w1', { localProvider, requirePhysicalStop: true })
    ).rejects.toThrow('ssh channel closed')
  })

  // Why (#11960): the wedge the escape hatch exists for — an unresponsive daemon, a dropped
  // SSH channel — rejects the sweep in the provider's own words, which the force classifier
  // cannot recognise. Failing closed with no Force Delete button is the dead end itself.
  it('offers force delete for a sweep-level failure without losing the provider wording', async () => {
    listRegisteredPtysMock.mockReturnValue([])
    const localProvider = createProviderStub(async () => {
      throw new Error('SSH channel closed while listing processes')
    })

    const error = await killAllProcessesForWorktree('repo-1::/w', {
      localProvider,
      requirePhysicalStop: true
    }).then(
      () => new Error('expected a rejection'),
      (rejection: Error) => rejection
    )
    expect(error.message).toContain('SSH channel closed while listing processes')
    expect(classifyWorktreeForceDeleteReason(error.message)).toBe('unstopped-pty')
    // Nothing was verified here, so it must not read as the proven-live verdict.
    expect(isProvenLivePtyRemovalError(error.message)).toBe(false)
  })

  // Why: the outer deadline rejects without cancelling the sweep it gave up on, so force
  // could return — and the caller start deleting the directory — while shutdown() was still
  // killing the PTY holding it open. On Windows that rmdir fails and half-deletes the
  // workspace, which is exactly what the ordering at the removal call site exists to avoid.
  it('waits for a shutdown the deadline abandoned before force returns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let releaseShutdown: () => void = () => {}
    try {
      listRegisteredPtysMock.mockReturnValue([])
      const localProvider = createProviderStub(async () => [
        { id: 'w1@@live-1', cwd: '/tmp/w1', title: 'shell' }
      ])
      let shutdownFinished = false
      ;(localProvider.shutdown as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async () =>
          await new Promise<void>((resolve) => {
            releaseShutdown = () => {
              shutdownFinished = true
              resolve()
            }
          })
      )

      const teardown = settleTeardown(
        killAllProcessesForWorktree('w1', {
          localProvider,
          timeoutMs: 30,
          requirePhysicalStop: true,
          allowUnverifiedStop: true
        })
      )
      let returned = false
      void teardown.then(() => {
        returned = true
      })
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(shutdownFinished).toBe(false)
      expect(returned).toBe(false)
      releaseShutdown()
      await expect(teardown).resolves.toEqual({
        runtimeStopped: 0,
        providerStopped: 0,
        registryStopped: 0
      })
    } finally {
      releaseShutdown()
      warn.mockRestore()
    }
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
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('w1@@live-1'))
      // Why: unregistering a PTY we just watched stay alive would hide it from
      // the next sweep and from the user — the discoverability half of #11960.
      expect(onPtyStopped).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
