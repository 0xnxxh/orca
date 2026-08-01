import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  mobileTasksHostRoute,
  mobileTasksRoute,
  mobileTasksRouteForMountedHost,
  navigateToMobileTasks
} from './mobile-task-navigation'

afterEach(() => {
  const pending = getPendingMobileTasksNavigation()
  if (pending) {
    clearPendingMobileTasksNavigation(pending)
  }
})

describe('mobileTasksRoute', () => {
  it('builds a concrete encoded host route', () => {
    expect(mobileTasksRoute('host/1')).toBe('/h/host%2F1/tasks')
    expect(mobileTasksRoute('host/1', 'linear')).toBe('/h/host%2F1/tasks?taskSource=linear')
  })

  it('publishes the concrete route before mounting the encoded host index', () => {
    const push = vi.fn()

    navigateToMobileTasks({ push }, 'host/1', 'github')
    expect(push).toHaveBeenCalledWith(mobileTasksHostRoute('host/1'))
    expect(getPendingMobileTasksNavigation()).toEqual({
      hostId: 'host/1',
      route: '/h/host%2F1/tasks?taskSource=github'
    })
  })

  it('uses a pending route only for its intended host or a cold host with lost params', () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'linear')
    const pending = getPendingMobileTasksNavigation()

    expect(mobileTasksRouteForMountedHost('host-1', pending)).toBe(
      '/h/host-1/tasks?taskSource=linear'
    )
    expect(mobileTasksRouteForMountedHost(undefined, pending)).toBe(
      '/h/host-1/tasks?taskSource=linear'
    )
    expect(mobileTasksRouteForMountedHost('host-2', pending)).toBeNull()
  })

  it('keeps a newer intent when stale cleanup races repeated navigation', () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'github')
    const first = getPendingMobileTasksNavigation()!
    navigateToMobileTasks({ push: vi.fn() }, 'host-2', 'gitlab')
    const second = getPendingMobileTasksNavigation()!

    clearPendingMobileTasksNavigation(first)
    expect(getPendingMobileTasksNavigation()).toBe(second)
    expect(second).toEqual({ hostId: 'host-2', route: '/h/host-2/tasks?taskSource=gitlab' })
    clearPendingMobileTasksNavigation(second)
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })

  it('clears the intent if opening the host route throws', () => {
    const error = new Error('navigation failed')

    expect(() =>
      navigateToMobileTasks(
        {
          push: () => {
            throw error
          }
        },
        'host-1'
      )
    ).toThrow(error)
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })
})
