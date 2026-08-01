import { createElement, type ReactNode, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  navigateToMobileTasks,
  type MobileTasksRoute
} from './mobile-task-navigation'
import { useMobileTaskHostNavigation } from './use-mobile-task-host-navigation'

function HostStackContent({ onCommit }: { onCommit: () => void }) {
  useEffect(onCommit, [onCommit])
  return createElement('HostScreen')
}

function HostLayoutHarness({
  children,
  hostId,
  replace
}: {
  children: ReactNode
  hostId?: string
  replace: (route: MobileTasksRoute) => void
}) {
  useMobileTaskHostNavigation({ replace }, hostId)
  return children
}

describe('useMobileTaskHostNavigation', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    const pending = getPendingMobileTasksNavigation()
    if (pending) {
      clearPendingMobileTasksNavigation(pending)
    }
    vi.restoreAllMocks()
  })

  async function renderLayout(args: {
    hostId?: string
    onCommit: () => void
    replace: (route: MobileTasksRoute) => void
  }): Promise<void> {
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...errorArgs) => {
      if (
        typeof errorArgs[0] !== 'string' ||
        !errorArgs[0].includes('react-test-renderer is deprecated')
      ) {
        throw new Error(String(errorArgs[0]))
      }
    })
    try {
      await act(async () => {
        renderer = create(
          createElement(
            HostLayoutHarness,
            { hostId: args.hostId, replace: args.replace },
            createElement(HostStackContent, { onCommit: args.onCommit })
          )
        )
      })
    } finally {
      consoleError.mockRestore()
    }
  }

  it('waits for host content to commit before replacing a cold route with lost params', async () => {
    let hostCommitted = false
    navigateToMobileTasks({ push: vi.fn() }, 'host/1', 'github')
    const replace = vi.fn((route: MobileTasksRoute) => {
      expect(hostCommitted).toBe(true)
      expect(route).toBe('/h/host%2F1/tasks?taskSource=github')
    })

    await renderLayout({
      onCommit: () => {
        hostCommitted = true
      },
      replace
    })

    expect(replace).toHaveBeenCalledOnce()
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })

  it('clears a mismatched host intent without replacing', async () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'linear')
    const replace = vi.fn()

    await renderLayout({ hostId: 'host-2', onCommit: vi.fn(), replace })

    expect(replace).not.toHaveBeenCalled()
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })

  it('consumes only the latest intent from repeated taps', async () => {
    navigateToMobileTasks({ push: vi.fn() }, 'host-1', 'github')
    navigateToMobileTasks({ push: vi.fn() }, 'host-2', 'gitlab')
    const replace = vi.fn()

    await renderLayout({ hostId: 'host-2', onCommit: vi.fn(), replace })

    expect(replace).toHaveBeenCalledWith('/h/host-2/tasks?taskSource=gitlab')
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })
})
