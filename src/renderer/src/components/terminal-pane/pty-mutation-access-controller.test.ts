import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyMutationAccess } from '../../../../shared/pty-mutation-identity'
import {
  createPtyMutationAccessController,
  PTY_MUTATION_PENDING_OPERATION_LIMIT
} from './pty-mutation-access-controller'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('PTY mutation access controller', () => {
  const originalWindow = globalThis.window
  const api = {
    claimMutationAccess: vi.fn(),
    write: vi.fn(),
    writeAccepted: vi.fn().mockResolvedValue(true),
    resize: vi.fn(),
    claimViewport: vi.fn(),
    signal: vi.fn(),
    clearBuffer: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { window: Window }).window = {
      setTimeout,
      clearTimeout,
      api: { ...originalWindow?.api, pty: api }
    } as unknown as Window
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalWindow) {
      ;(globalThis as { window: Window }).window = originalWindow
    } else {
      delete (globalThis as { window?: Window }).window
    }
  })

  it('queues structural attach mutations but refuses input until exact access resolves', async () => {
    const claim = deferred<PtyMutationAccess>()
    api.claimMutationAccess.mockReturnValueOnce(claim.promise)
    const controller = createPtyMutationAccessController({
      tabId: 'terminal-tab-1',
      leafId: 'leaf-1',
      paneGeneration: 4
    })
    const identity = {
      incarnationId: 'incarnation-1',
      paneGeneration: 4,
      mutationLeaseId: 'lease-1'
    }

    controller.bind('pty-1')
    expect(controller.canMutate('pty-1')).toBe(false)
    expect(controller.write('pty-1', 'a')).toBe(false)
    expect(controller.resize('pty-1', 120, 40, true)).toBe(true)
    expect(controller.signal('pty-1', 'SIGWINCH')).toBe(true)
    expect(controller.clearBuffer('pty-1')).toBe(true)
    const accepted = controller.writeAccepted('pty-1', 'b')
    const killed = controller.kill('pty-1', true)

    expect(api.write).not.toHaveBeenCalled()
    expect(api.kill).not.toHaveBeenCalled()
    const claimant = api.claimMutationAccess.mock.calls[0]?.[0].claimant
    claim.resolve({ mode: 'exact', identity, claimant })
    await expect(accepted).resolves.toBe(false)
    await expect(killed).resolves.toBeUndefined()
    expect(controller.canMutate('pty-1')).toBe(true)
    expect(controller.write('pty-1', 'after-claim')).toBe(true)
    await expect(controller.writeAccepted('pty-1', 'acknowledged')).resolves.toBe(true)

    expect(api.claimMutationAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pty-1',
        tabId: 'terminal-tab-1',
        leafId: 'leaf-1',
        paneGeneration: 4,
        claimant
      })
    )
    expect(api.write).toHaveBeenCalledExactlyOnceWith('pty-1', 'after-claim', identity)
    expect(api.resize).toHaveBeenCalledWith('pty-1', 120, 40, identity)
    expect(api.claimViewport).toHaveBeenCalledWith('pty-1', 120, 40, identity)
    expect(api.signal).toHaveBeenCalledWith('pty-1', 'SIGWINCH', identity)
    expect(api.clearBuffer).toHaveBeenCalledWith('pty-1', identity)
    expect(api.writeAccepted).toHaveBeenCalledExactlyOnceWith('pty-1', 'acknowledged', identity)
    expect(api.kill).toHaveBeenCalledWith('pty-1', {
      keepHistory: true,
      mutationIdentity: identity
    })
  })

  it('drops queued mutations when the attaching pane releases before its claim settles', async () => {
    const claim = deferred<PtyMutationAccess>()
    api.claimMutationAccess.mockReturnValueOnce(claim.promise)
    const controller = createPtyMutationAccessController({
      tabId: 'terminal-tab-1',
      leafId: 'leaf-1',
      paneGeneration: 1
    })

    controller.bind('pty-reused')
    const claimant = api.claimMutationAccess.mock.calls[0]?.[0].claimant
    controller.write('pty-reused', 'stale')
    controller.release()
    claim.resolve({
      mode: 'exact',
      identity: {
        incarnationId: 'replacement-incarnation',
        paneGeneration: 2,
        mutationLeaseId: 'replacement-lease'
      },
      claimant
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(api.write).not.toHaveBeenCalled()
  })

  it('keeps explicitly negotiated legacy peers on the allocation-free mutation path', () => {
    const controller = createPtyMutationAccessController({})
    controller.bind('legacy-pty', { mode: 'legacy' })

    controller.write('legacy-pty', 'input')
    controller.resize('legacy-pty', 80, 24)

    expect(api.claimMutationAccess).not.toHaveBeenCalled()
    expect(api.write).toHaveBeenCalledWith('legacy-pty', 'input')
    expect(api.resize).toHaveBeenCalledWith('legacy-pty', 80, 24)
  })

  it('defaults unmarked callers to the backward-compatible legacy path', () => {
    const controller = createPtyMutationAccessController({})
    controller.bind('legacy-pty')

    controller.write('legacy-pty', 'input')

    expect(api.claimMutationAccess).not.toHaveBeenCalled()
    expect(api.write).toHaveBeenCalledWith('legacy-pty', 'input')
  })

  it('keeps exact write overhead to one synchronous IPC send with one stable identity', () => {
    const controller = createPtyMutationAccessController({
      tabId: 'terminal-tab-1',
      leafId: 'leaf-1',
      paneGeneration: 4
    })
    const claimant = controller.prepareBinding()
    const identity = {
      incarnationId: 'incarnation-1',
      paneGeneration: 4,
      mutationLeaseId: 'lease-1'
    }
    controller.bind('pty-1', { mode: 'exact', identity, claimant }, claimant)
    const stableTarget = controller.captureTarget('pty-1')

    for (let index = 0; index < 10_000; index += 1) {
      controller.write('pty-1', 'a')
    }

    expect(api.claimMutationAccess).not.toHaveBeenCalled()
    expect(api.write).toHaveBeenCalledTimes(10_000)
    const dispatchedIdentity = api.write.mock.calls[0]?.[2]
    expect(dispatchedIdentity).toEqual(identity)
    expect(api.write.mock.calls.every((call) => call[2] === dispatchedIdentity)).toBe(true)
    expect(controller.captureTarget('pty-1')).toBe(stableTarget)
  })

  it('keeps one claim pending beyond the former deadline without losing queued work', async () => {
    vi.useFakeTimers()
    api.claimMutationAccess.mockImplementation(() => new Promise(() => {}))
    const onUnavailable = vi.fn()
    const controller = createPtyMutationAccessController({
      tabId: 'terminal-tab-1',
      leafId: 'leaf-1',
      paneGeneration: 4,
      onUnavailable
    })

    controller.bind('pty-1')
    expect(controller.write('pty-1', 'unacknowledged')).toBe(false)
    expect(controller.resize('pty-1', 100, 30)).toBe(true)
    const accepted = controller.writeAccepted('pty-1', 'acknowledged')
    const killed = controller.kill('pty-1').catch((error: unknown) => error)
    await expect(accepted).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(75_000)

    expect(api.write).not.toHaveBeenCalled()
    expect(api.resize).not.toHaveBeenCalled()
    expect(api.kill).not.toHaveBeenCalled()
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(api.claimMutationAccess).toHaveBeenCalledOnce()

    controller.release()
    await expect(killed).resolves.toMatchObject({ message: 'pty_mutation_access_released' })
  })

  it('fails only after an explicit unavailable response and never retries it', async () => {
    vi.useFakeTimers()
    api.claimMutationAccess.mockResolvedValueOnce({ mode: 'unavailable' })
    const onUnavailable = vi.fn()
    const controller = createPtyMutationAccessController({
      tabId: 'terminal-tab-1',
      leafId: 'leaf-1',
      paneGeneration: 4,
      onUnavailable
    })

    controller.bind('pty-1')
    const killed = controller.kill('pty-1').catch((error: unknown) => error)
    await Promise.resolve()
    await Promise.resolve()

    await expect(killed).resolves.toMatchObject({ message: 'pty_mutation_access_unavailable' })
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'pty_mutation_access_unavailable' })
    )
    await vi.advanceTimersByTimeAsync(75_000)
    expect(api.claimMutationAccess).toHaveBeenCalledOnce()
  })

  it('refuses only the overflowing operation and preserves accepted pending work', async () => {
    const claim = deferred<PtyMutationAccess>()
    api.claimMutationAccess.mockReturnValueOnce(claim.promise)
    const onUnavailable = vi.fn()
    const controller = createPtyMutationAccessController({
      tabId: 'terminal-tab-1',
      leafId: 'leaf-1',
      paneGeneration: 4,
      onUnavailable
    })
    controller.bind('pty-1')

    for (let index = 0; index < PTY_MUTATION_PENDING_OPERATION_LIMIT; index += 1) {
      expect(controller.resize('pty-1', 80 + (index % 2), 24)).toBe(true)
    }
    expect(controller.resize('pty-1', 120, 40)).toBe(false)
    const accepted = controller.writeAccepted('pty-1', 'after-overflow')

    await expect(accepted).resolves.toBe(false)
    expect(api.resize).not.toHaveBeenCalled()
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(api.claimMutationAccess).toHaveBeenCalledOnce()

    const claimant = api.claimMutationAccess.mock.calls[0]?.[0].claimant
    claim.resolve({
      mode: 'exact',
      identity: {
        incarnationId: 'incarnation-overflow',
        paneGeneration: 4,
        mutationLeaseId: 'lease-overflow'
      },
      claimant
    })
    await vi.waitFor(() => {
      expect(api.resize).toHaveBeenCalledTimes(PTY_MUTATION_PENDING_OPERATION_LIMIT)
    })
  })
})
