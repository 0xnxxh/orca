import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileTaskHostRoute } from './MobileTaskHostRoute'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  navigateToMobileTasks
} from './mobile-task-navigation'

const mocks = vi.hoisted(() => ({
  params: {} as { hostId?: string },
  isWideLayout: false
}))

vi.mock('expo-router', () => ({
  Redirect: 'Redirect',
  useLocalSearchParams: () => mocks.params
}))

vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: mocks.isWideLayout })
}))

vi.mock('../components/WorkspaceDetailPlaceholder', () => ({
  WorkspaceDetailPlaceholder: 'WorkspaceDetailPlaceholder'
}))

function HostScreen() {
  return createElement('HostScreen')
}

describe('MobileTaskHostRoute', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    mocks.params = {}
    mocks.isWideLayout = false
    const pending = getPendingMobileTasksNavigation()
    if (pending) {
      clearPendingMobileTasksNavigation(pending)
    }
    vi.restoreAllMocks()
  })

  async function renderRoute(): Promise<ReactTestRenderer> {
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        throw new Error(String(args[0]))
      }
    })
    try {
      await act(async () => {
        renderer = create(createElement(MobileTaskHostRoute, { hostScreen: HostScreen }))
      })
    } finally {
      consoleError.mockRestore()
    }
    return renderer!
  }

  it('redirects from the cold host shell even when Expo drops its route params', async () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host/1', 'github')
    const pending = getPendingMobileTasksNavigation()

    const route = await renderRoute()

    expect(route.root.findByType('Redirect').props.href).toBe('/h/host%2F1/tasks?taskSource=github')
    expect(getPendingMobileTasksNavigation()).toBe(pending)

    act(() => route.unmount())
    renderer = null
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })

  it('clears a stale intent instead of redirecting a different mounted host', async () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'linear')
    mocks.params = { hostId: 'host-2' }

    const route = await renderRoute()

    expect(route.root.findByType('HostScreen')).toBeDefined()
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })

  it('preserves the wide-layout placeholder without a pending intent', async () => {
    mocks.isWideLayout = true

    const route = await renderRoute()

    expect(route.root.findByType('WorkspaceDetailPlaceholder')).toBeDefined()
  })
})
