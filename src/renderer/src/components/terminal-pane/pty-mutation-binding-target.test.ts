import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_INPUT_CHUNK_MAX_BYTES } from '../../../../shared/terminal-input'
import { createPtyInputWriteQueue } from './pty-input-write-queue'
import { createPtyMutationAccessController } from './pty-mutation-access-controller'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('PTY mutation binding targets', () => {
  const originalWindow = globalThis.window
  const api = {
    claimMutationAccess: vi.fn(),
    write: vi.fn(),
    writeAccepted: vi.fn(),
    resize: vi.fn(),
    claimViewport: vi.fn(),
    signal: vi.fn(),
    clearBuffer: vi.fn(),
    kill: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { window: Window }).window = {
      api: { ...originalWindow?.api, pty: api }
    } as unknown as Window
  })

  afterEach(() => {
    if (originalWindow) {
      ;(globalThis as { window: Window }).window = originalWindow
    } else {
      delete (globalThis as { window?: Window }).window
    }
  })

  it('does not let an acknowledged old-binding write continue into a same-ID successor', async () => {
    const controller = createPtyMutationAccessController({ paneGeneration: 1 })
    const oldClaimant = controller.prepareBinding()
    const oldIdentity = {
      incarnationId: 'incarnation-old',
      paneGeneration: 1,
      mutationLeaseId: 'lease-old'
    }
    controller.bind('same-id', { mode: 'exact', identity: oldIdentity, claimant: oldClaimant })
    const oldTarget = controller.captureTarget('same-id')!
    const oldWrite = deferred<boolean>()
    api.writeAccepted.mockReturnValueOnce(oldWrite.promise)

    const accepted = controller.writeAcceptedTarget(oldTarget, 'old-chunk')
    const successorClaimant = controller.prepareBinding()
    const successorIdentity = {
      incarnationId: 'incarnation-successor',
      paneGeneration: 1,
      mutationLeaseId: 'lease-successor'
    }
    controller.bind('same-id', {
      mode: 'exact',
      identity: successorIdentity,
      claimant: successorClaimant
    })
    oldWrite.resolve(true)

    await expect(accepted).resolves.toBe(false)
    expect(controller.writeTarget(oldTarget, 'stale-tail')).toBe(false)
    expect(controller.writeTarget(controller.captureTarget('same-id')!, 'successor')).toBe(true)
    expect(api.writeAccepted).toHaveBeenCalledWith('same-id', 'old-chunk', oldIdentity)
    expect(api.write).toHaveBeenCalledExactlyOnceWith('same-id', 'successor', successorIdentity)
  })

  it('drops the remaining chunks when the queue target is superseded between yields', async () => {
    type Target = { id: string; revision: number }
    let currentRevision = 1
    const writes: { target: Target; data: string }[] = []
    const pendingYield = deferred<void>()
    const queue = createPtyInputWriteQueue<Target>({
      isWritable: (target) => target.revision === currentRevision,
      write: (target, data) => writes.push({ target, data }),
      sameTarget: (left, right) => left.id === right.id && left.revision === right.revision,
      yieldBetweenWrites: () => pendingYield.promise
    })
    const oldTarget = { id: 'same-id', revision: 1 }
    const successorTarget = { id: 'same-id', revision: 2 }

    queue.enqueue(oldTarget, 'x'.repeat(TERMINAL_INPUT_CHUNK_MAX_BYTES * 3))
    expect(writes).toHaveLength(1)
    currentRevision = 2
    queue.enqueue(successorTarget, 'successor')
    pendingYield.resolve()
    await queue.waitForDrain()

    expect(writes).toEqual([
      { target: oldTarget, data: 'x'.repeat(TERMINAL_INPUT_CHUNK_MAX_BYTES) },
      { target: successorTarget, data: 'successor' }
    ])
  })
})
