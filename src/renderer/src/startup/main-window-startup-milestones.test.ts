import { describe, expect, it, vi } from 'vitest'
import { createMainWindowStartupMilestoneScheduler } from './main-window-startup-milestones'

function createFrameHarness() {
  let nextId = 0
  const frames = new Map<number, (timestamp: number) => void>()
  return {
    cancelFrame: vi.fn((id: number) => frames.delete(id)),
    flushNext() {
      const next = frames.entries().next().value as
        | [number, (timestamp: number) => void]
        | undefined
      if (!next) {
        throw new Error('No frame scheduled')
      }
      frames.delete(next[0])
      next[1](next[0])
    },
    pending: () => frames.size,
    requestFrame: vi.fn((callback: (timestamp: number) => void) => {
      const id = ++nextId
      frames.set(id, callback)
      return id
    })
  }
}

describe('main-window startup milestones', () => {
  it('survives StrictMode cleanup and emits commit and post-commit paint once', () => {
    const frames = createFrameHarness()
    const log = vi.fn()
    const schedule = createMainWindowStartupMilestoneScheduler({
      log,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame
    })

    const strictModeCleanup = schedule()
    expect(log).toHaveBeenCalledWith('first-react-commit')
    strictModeCleanup()
    expect(frames.pending()).toBe(0)

    schedule()
    frames.flushNext()
    expect(log).toHaveBeenCalledTimes(1)
    frames.flushNext()
    expect(log.mock.calls).toEqual([['first-react-commit'], ['shell-painted']])

    schedule()
    expect(frames.pending()).toBe(0)
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('contains logging and frame-scheduler failures', () => {
    const schedule = createMainWindowStartupMilestoneScheduler({
      log: () => {
        throw new Error('IPC unavailable')
      },
      requestFrame: () => {
        throw new Error('frame unavailable')
      },
      cancelFrame: () => {
        throw new Error('cancel unavailable')
      }
    })

    expect(() => schedule()).not.toThrow()
    expect(() => schedule()()).not.toThrow()
  })
})
