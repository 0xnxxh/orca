import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  mobileTasksHostRoute,
  mobileTasksScreenParamsForMountedHost,
  navigateToMobileTasks
} from './mobile-task-navigation'

afterEach(() => {
  const pending = getPendingMobileTasksNavigation()
  if (pending) {
    clearPendingMobileTasksNavigation(pending)
  }
})

describe('mobile task navigation', () => {
  it('builds an encoded host route', () => {
    expect(mobileTasksHostRoute('host/1')).toBe('/h/host%2F1')
  })

  it('publishes direct screen params before mounting the encoded host index', () => {
    const push = vi.fn()

    navigateToMobileTasks({ push }, 'host/1')
    expect(push).toHaveBeenCalledWith(mobileTasksHostRoute('host/1'))
    expect(getPendingMobileTasksNavigation()).toEqual({ hostId: 'host/1' })
  })

  it('uses pending params only for the intended host or a cold host with lost params', () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'linear')
    const pending = getPendingMobileTasksNavigation()

    expect(mobileTasksScreenParamsForMountedHost('host-1', pending)).toEqual({
      hostId: 'host-1',
      taskSource: 'linear'
    })
    expect(mobileTasksScreenParamsForMountedHost(undefined, pending)).toBe(pending)
    expect(mobileTasksScreenParamsForMountedHost('host-2', pending)).toBeNull()
  })

  it('keeps a newer intent when stale cleanup races repeated navigation', () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'github')
    const first = getPendingMobileTasksNavigation()!
    navigateToMobileTasks({ push: vi.fn() }, 'host-2', 'gitlab')
    const second = getPendingMobileTasksNavigation()!

    clearPendingMobileTasksNavigation(first)
    expect(getPendingMobileTasksNavigation()).toBe(second)
    expect(second).toEqual({ hostId: 'host-2', taskSource: 'gitlab' })
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
