import { describe, expect, it, vi } from 'vitest'
import { mobileTasksRoute, navigateToMobileTasks } from './mobile-task-navigation'

describe('mobileTasksRoute', () => {
  it('builds a concrete encoded host route', () => {
    expect(mobileTasksRoute('host/1')).toBe('/h/host%2F1/tasks')
    expect(mobileTasksRoute('host/1', 'linear')).toBe('/h/host%2F1/tasks?taskSource=linear')
  })

  it('mounts a cold host navigator before replacing its index with Tasks', () => {
    let nextFrame: FrameRequestCallback | null = null
    const push = vi.fn()
    const replace = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })

    navigateToMobileTasks({ push, replace }, 'host-1', 'github')
    expect(push).toHaveBeenCalledWith('/h/host-1')
    expect(replace).not.toHaveBeenCalled()

    nextFrame?.(0)
    expect(replace).toHaveBeenCalledWith(mobileTasksRoute('host-1', 'github'))
    vi.unstubAllGlobals()
  })
})
