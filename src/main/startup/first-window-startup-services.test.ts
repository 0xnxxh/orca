import { describe, expect, it, vi } from 'vitest'
import {
  FIRST_WINDOW_STARTUP_SERVICE_TIMEOUT_MS,
  LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS,
  startFirstWindowStartupServices
} from './first-window-startup-services'

describe('startFirstWindowStartupServices', () => {
  it('starts daemon and hook services concurrently before awaiting either', async () => {
    const events: string[] = []
    let resolveDaemon!: () => void
    let resolveHooks!: () => void

    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () =>
        new Promise<void>((resolve) => {
          events.push('daemon-started')
          resolveDaemon = resolve
        }),
      startAgentHookServer: () =>
        new Promise<void>((resolve) => {
          events.push('hooks-started')
          resolveHooks = resolve
        }),
      reconcileWslHookRelays: vi.fn(async () => {}),
      onDaemonError: vi.fn(),
      onAgentHookServerError: vi.fn(),
      onWslHookRelayReconciliationError: vi.fn()
    })

    await Promise.resolve()
    expect(events).toEqual(['daemon-started', 'hooks-started'])

    let completed = false
    started.firstWindowReady.then(() => {
      completed = true
    })

    resolveDaemon()
    await Promise.resolve()
    expect(completed).toBe(false)

    resolveHooks()
    await started.firstWindowReady
    await started.localPtyReady
    await started.localPtyProviderReady
    expect(completed).toBe(true)
  })

  it('starts reconciliation after both authorities without gating unrelated local PTYs', async () => {
    const events: string[] = []
    let resolveDaemon!: () => void
    let resolveHooks!: () => void
    let resolveRelays!: () => void
    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () =>
        new Promise<void>((resolve) => {
          events.push('daemon-started')
          resolveDaemon = resolve
        }),
      startAgentHookServer: () =>
        new Promise<void>((resolve) => {
          events.push('hooks-started')
          resolveHooks = resolve
        }),
      reconcileWslHookRelays: () =>
        new Promise<void>((resolve) => {
          events.push('relay-reconciliation-started')
          resolveRelays = () => {
            events.push('relay-reconciliation-ready')
            resolve()
          }
        }),
      onDaemonError: vi.fn(),
      onAgentHookServerError: vi.fn(),
      onWslHookRelayReconciliationError: vi.fn()
    })
    await Promise.resolve()

    resolveHooks()
    await Promise.resolve()
    expect(events).toEqual(['daemon-started', 'hooks-started'])

    resolveDaemon()
    await vi.waitFor(() => expect(events).toContain('relay-reconciliation-started'))
    let firstWindowReady = false
    void started.firstWindowReady.then(() => {
      firstWindowReady = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(firstWindowReady).toBe(true)
    let localPtyReady = false
    void started.localPtyReady.then(() => {
      localPtyReady = true
    })
    await started.localPtyReady
    expect(localPtyReady).toBe(true)
    expect(events).not.toContain('relay-reconciliation-ready')

    resolveRelays()
    await vi.waitFor(() => expect(events).toContain('relay-reconciliation-ready'))
  })

  it('reports reconciliation failure and still opens the startup gate', async () => {
    const onWslHookRelayReconciliationError = vi.fn()
    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () => Promise.resolve(),
      startAgentHookServer: () => Promise.resolve(),
      reconcileWslHookRelays: () => Promise.reject(new Error('inventory unavailable')),
      onDaemonError: vi.fn(),
      onAgentHookServerError: vi.fn(),
      onWslHookRelayReconciliationError
    })

    await expect(started.localPtyReady).resolves.toBeUndefined()
    await vi.waitFor(() =>
      expect(onWslHookRelayReconciliationError).toHaveBeenCalledWith(expect.any(Error))
    )
  })

  it('opens the provider gate when daemon startup finishes without waiting for hooks', async () => {
    let resolveDaemon!: () => void
    let resolveHooks!: () => void
    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () =>
        new Promise<void>((resolve) => {
          resolveDaemon = resolve
        }),
      startAgentHookServer: () =>
        new Promise<void>((resolve) => {
          resolveHooks = resolve
        }),
      reconcileWslHookRelays: vi.fn(async () => {}),
      onDaemonError: vi.fn(),
      onAgentHookServerError: vi.fn(),
      onWslHookRelayReconciliationError: vi.fn()
    })
    await Promise.resolve()

    let allServicesReady = false
    void started.localPtyReady.then(() => {
      allServicesReady = true
    })
    resolveDaemon()
    await expect(started.localPtyProviderReady).resolves.toBeUndefined()
    expect(allServicesReady).toBe(false)

    resolveHooks()
    await started.localPtyReady
  })

  it('logs each service failure and still resolves the startup barrier', async () => {
    const onDaemonError = vi.fn()
    const onAgentHookServerError = vi.fn()

    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () => Promise.reject(new Error('daemon failed')),
      startAgentHookServer: () => Promise.reject(new Error('hooks failed')),
      reconcileWslHookRelays: vi.fn(async () => {}),
      onDaemonError,
      onAgentHookServerError,
      onWslHookRelayReconciliationError: vi.fn()
    })

    await expect(started.firstWindowReady).resolves.toBeUndefined()
    await expect(started.localPtyReady).resolves.toBeUndefined()
    await expect(started.localPtyProviderReady).resolves.toBeUndefined()

    expect(onDaemonError).toHaveBeenCalledWith(expect.any(Error))
    expect(onAgentHookServerError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('logs synchronous service startup failures and still resolves the startup barrier', async () => {
    const onDaemonError = vi.fn()
    const onAgentHookServerError = vi.fn()

    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () => {
        throw new Error('daemon sync failed')
      },
      startAgentHookServer: () => {
        throw new Error('hooks sync failed')
      },
      reconcileWslHookRelays: vi.fn(async () => {}),
      onDaemonError,
      onAgentHookServerError,
      onWslHookRelayReconciliationError: vi.fn()
    })

    await expect(started.firstWindowReady).resolves.toBeUndefined()
    await expect(started.localPtyReady).resolves.toBeUndefined()
    await expect(started.localPtyProviderReady).resolves.toBeUndefined()

    expect(onDaemonError).toHaveBeenCalledWith(expect.any(Error))
    expect(onAgentHookServerError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('opens the first window at the window timeout without aborting a slow daemon or opening the PTY gate', async () => {
    vi.useFakeTimers()
    const onDaemonError = vi.fn()
    let daemonSignal: AbortSignal | undefined
    let resolveDaemon!: () => void

    try {
      const started = startFirstWindowStartupServices({
        startDaemonPtyProvider: (signal) => {
          daemonSignal = signal
          return new Promise<void>((resolve) => {
            resolveDaemon = resolve
          })
        },
        startAgentHookServer: () => Promise.resolve(),
        reconcileWslHookRelays: vi.fn(async () => {}),
        onDaemonError,
        onAgentHookServerError: vi.fn(),
        onWslHookRelayReconciliationError: vi.fn()
      })

      let ptyGateOpened = false
      void started.localPtyReady.then(() => {
        ptyGateOpened = true
      })

      await vi.advanceTimersByTimeAsync(FIRST_WINDOW_STARTUP_SERVICE_TIMEOUT_MS)
      await expect(started.firstWindowReady).resolves.toBeUndefined()

      // Why: opening the PTY gate before the daemon attempt finishes would
      // spawn non-restorable LocalPtyProvider fallback terminals (#5232).
      expect(ptyGateOpened).toBe(false)
      expect(daemonSignal?.aborted).toBe(false)
      expect(onDaemonError).not.toHaveBeenCalled()

      resolveDaemon()
      await expect(started.localPtyReady).resolves.toBeUndefined()
      await expect(started.localPtyProviderReady).resolves.toBeUndefined()
      expect(daemonSignal?.aborted).toBe(false)
      expect(onDaemonError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open the local PTY gate at the hard cap while aborting hung services', async () => {
    vi.useFakeTimers()
    const onDaemonError = vi.fn()
    const onAgentHookServerError = vi.fn()
    const reconcileWslHookRelays = vi.fn(async () => {})
    let daemonSignal: AbortSignal | undefined

    try {
      const started = startFirstWindowStartupServices({
        startDaemonPtyProvider: (signal) => {
          daemonSignal = signal
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
        startAgentHookServer: () => Promise.resolve(),
        reconcileWslHookRelays,
        onDaemonError,
        onAgentHookServerError,
        onWslHookRelayReconciliationError: vi.fn()
      })

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS)
      await expect(started.firstWindowReady).resolves.toBeUndefined()
      await expect(started.localPtyReady).resolves.toBeUndefined()
      await expect(started.localPtyProviderReady).resolves.toBeUndefined()

      expect(onDaemonError).toHaveBeenCalledWith(expect.any(Error))
      expect(onAgentHookServerError).not.toHaveBeenCalled()
      expect(daemonSignal?.aborted).toBe(true)
      expect(reconcileWslHookRelays).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
