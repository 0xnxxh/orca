import { createElement, type ReactNode, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingMobileTasksNavigation,
  getPendingMobileTasksNavigation,
  navigateToMobileTasks,
  type MobileTasksScreenParams
} from './mobile-task-navigation'
import {
  useMobileTaskHostNavigation,
  type MobileTasksHostNavigation
} from './use-mobile-task-host-navigation'

function HostStackContent({ onCommit }: { onCommit: () => void }) {
  useEffect(onCommit, [onCommit])
  return createElement('HostScreen')
}

function HostStackHarness({
  children,
  hostId,
  replace
}: {
  children: ReactNode
  hostId?: string
  replace: MobileTasksHostNavigation['replace']
}) {
  useMobileTaskHostNavigation({ replace }, hostId)
  return children
}

function HostProtocolGateHarness({ children, ready }: { children: ReactNode; ready: boolean }) {
  return ready ? children : createElement('CompatibilityScreen')
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
    replace: MobileTasksHostNavigation['replace']
    ready?: boolean
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
            HostProtocolGateHarness,
            { ready: args.ready ?? true },
            createElement(
              HostStackHarness,
              { hostId: args.hostId, replace: args.replace },
              createElement(HostStackContent, { onCommit: args.onCommit })
            )
          )
        )
      })
    } finally {
      consoleError.mockRestore()
    }
  }

  it('waits for the gated host stack to mount and commit before replacing', async () => {
    let hostCommitted = false
    navigateToMobileTasks({ push: vi.fn() }, 'host/1', 'github')
    const replace = vi.fn((screen: '[hostId]/tasks', params: MobileTasksScreenParams) => {
      expect(hostCommitted).toBe(true)
      expect(screen).toBe('[hostId]/tasks')
      expect(params).toEqual({ hostId: 'host/1', taskSource: 'github' })
    })

    await renderLayout({
      onCommit: () => {
        hostCommitted = true
      },
      ready: false,
      replace
    })

    expect(replace).not.toHaveBeenCalled()
    expect(getPendingMobileTasksNavigation()).not.toBeNull()

    await act(async () => {
      renderer?.update(
        createElement(
          HostProtocolGateHarness,
          { ready: true },
          createElement(
            HostStackHarness,
            { hostId: undefined, replace },
            createElement(HostStackContent, {
              onCommit: () => {
                hostCommitted = true
              }
            })
          )
        )
      )
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

    expect(replace).toHaveBeenCalledWith('[hostId]/tasks', {
      hostId: 'host-2',
      taskSource: 'gitlab'
    })
    expect(getPendingMobileTasksNavigation()).toBeNull()
  })
})
