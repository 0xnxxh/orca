import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  requestWindowsDescendantTreeTermination,
  WINDOWS_DESCENDANT_KILL_TIMEOUT_MS,
  type WindowsTreeKillSpawner
} from './windows-pty-descendant-termination'

function createChild(): Pick<ChildProcess, 'kill' | 'once' | 'unref'> & EventEmitter {
  const child = new EventEmitter() as Pick<ChildProcess, 'kill' | 'once' | 'unref'> & EventEmitter
  child.kill = vi.fn(() => true)
  child.unref = vi.fn()
  return child
}

describe('requestWindowsDescendantTreeTermination', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the System32 taskkill binary with a forceful tree argv', async () => {
    const child = createChild()
    const spawnProcess = vi.fn(() => child) as unknown as WindowsTreeKillSpawner
    const killing = requestWindowsDescendantTreeTermination(4321, {
      spawn: spawnProcess,
      env: { SystemRoot: 'C:\\Windows' }
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4321', '/T', '/F'],
      { shell: false, stdio: 'ignore', windowsHide: true }
    )
    expect(child.unref).toHaveBeenCalledOnce()

    child.emit('exit', 0, null)
    await expect(killing).resolves.toBeUndefined()
  })

  it('falls back to the bare binary and reports a non-zero exit', async () => {
    const child = createChild()
    const spawnProcess = vi.fn(() => child) as unknown as WindowsTreeKillSpawner
    const killing = requestWindowsDescendantTreeTermination(77, {
      spawn: spawnProcess,
      env: {}
    })

    expect(spawnProcess).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '77', '/T', '/F'],
      expect.any(Object)
    )
    child.emit('exit', 128, null)
    await expect(killing).rejects.toThrow('taskkill exited 128')
  })

  it.each([0, -1, 1.5, Number.NaN, undefined])(
    'does not spawn for invalid pid %s',
    async (rootPid) => {
      const spawnProcess = vi.fn() as unknown as WindowsTreeKillSpawner

      await expect(
        requestWindowsDescendantTreeTermination(rootPid as number, { spawn: spawnProcess })
      ).rejects.toThrow('Invalid Windows PTY root PID')
      expect(spawnProcess).not.toHaveBeenCalled()
    }
  )

  it('bounds a hung taskkill process and cancels it', async () => {
    vi.useFakeTimers()
    const child = createChild()
    const spawnProcess = vi.fn(() => child) as unknown as WindowsTreeKillSpawner
    const killing = requestWindowsDescendantTreeTermination(99, { spawn: spawnProcess })
    const rejection = expect(killing).rejects.toThrow('taskkill timed out')

    await vi.advanceTimersByTimeAsync(WINDOWS_DESCENDANT_KILL_TIMEOUT_MS)

    expect(child.kill).toHaveBeenCalledOnce()
    await rejection
  })

  it('reports spawn errors instead of treating them as proof', async () => {
    const child = createChild()
    const spawnProcess = vi.fn(() => child) as unknown as WindowsTreeKillSpawner
    const killing = requestWindowsDescendantTreeTermination(123, { spawn: spawnProcess })

    child.emit('error', new Error('blocked'))

    await expect(killing).rejects.toThrow('taskkill failed')
  })
})
