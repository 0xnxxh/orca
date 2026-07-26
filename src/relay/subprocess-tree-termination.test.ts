import * as ChildProcessModule from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() }
})

import {
  settleRelaySubprocessTreeAfterExit,
  terminateRelaySubprocessTree,
  terminateRelaySubprocessTreeAndWait
} from './subprocess-tree-termination'

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  vi.mocked(ChildProcessModule.execFile).mockReset()
  vi.mocked(ChildProcessModule.spawn).mockReset()
  vi.useRealTimers()
})

describe('terminateRelaySubprocessTree', () => {
  it('invokes Windows taskkill without a shell command', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const child = { pid: 12345, kill: vi.fn() } as unknown as ChildProcessModule.ChildProcess

    terminateRelaySubprocessTree(child)

    expect(ChildProcessModule.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '12345', '/T', '/F'],
      expect.any(Function)
    )
    expect(child.kill).not.toHaveBeenCalled()
  })
})

describe('terminateRelaySubprocessTreeAndWait', () => {
  it('waits for both Windows taskkill and child close', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const child = Object.assign(new EventEmitter(), { pid: 12345 })
    const killer = new EventEmitter()
    vi.mocked(ChildProcessModule.spawn).mockReturnValue(
      killer as unknown as ChildProcessModule.ChildProcess
    )
    let settled = false

    const pending = terminateRelaySubprocessTreeAndWait(
      child as unknown as ChildProcessModule.ChildProcess
    ).then(() => {
      settled = true
    })
    killer.emit('close', 0)
    await Promise.resolve()
    expect(settled).toBe(false)

    child.emit('close', 0)
    await pending
    expect(ChildProcessModule.spawn).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '12345', '/T', '/F'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    )
  })

  it('does not SIGKILL when a POSIX group disappears during grace', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    const child = Object.assign(new EventEmitter(), { pid: 12345 })
    let probes = 0
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        probes += 1
        if (probes > 1) {
          throw Object.assign(new Error('group gone'), { code: 'ESRCH' })
        }
      }
      return true
    })
    let settled = false
    try {
      const pending = terminateRelaySubprocessTreeAndWait(
        child as unknown as ChildProcessModule.ChildProcess
      ).then(() => {
        settled = true
      })
      child.emit('close', 0)

      await vi.advanceTimersByTimeAsync(999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await pending

      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM')
      expect(killSpy).not.toHaveBeenCalledWith(-12345, 'SIGKILL')
      expect(killSpy).toHaveBeenCalledWith(-12345, 0)
    } finally {
      killSpy.mockRestore()
    }
  })

  it('settles remaining descendants after a natural POSIX leader close', async () => {
    vi.useFakeTimers()
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    const child = Object.assign(new EventEmitter(), { pid: 12345 })
    let killed = false
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGKILL') {
        killed = true
      } else if (signal === 0 && killed) {
        throw Object.assign(new Error('group gone'), { code: 'ESRCH' })
      }
      return true
    })
    try {
      const pending = settleRelaySubprocessTreeAfterExit(
        child as unknown as ChildProcessModule.ChildProcess
      )
      await vi.advanceTimersByTimeAsync(1_000)
      await pending

      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL')
      expect(killSpy).toHaveBeenCalledWith(-12345, 0)
    } finally {
      killSpy.mockRestore()
    }
  })
})
