const MAX_QUEUED_NAMESPACE_OPERATIONS = 4

type Settlement<T> =
  | Readonly<{ kind: 'value'; value: T }>
  | Readonly<{ kind: 'error'; error: unknown }>
  | Readonly<{ kind: 'canceled' }>
  | Readonly<{ kind: 'timeout' }>

/** Owns every queue and pending transport wait for one exact host connection generation. */
export class TerminalAuthorityAppOutcomeConnectionGeneration {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly queuedCounts = new Map<string, number>()
  private readonly canceled: Promise<void>
  private cancelGeneration!: () => void
  private active = true

  constructor(readonly id: number) {
    this.canceled = new Promise((resolve) => {
      this.cancelGeneration = resolve
    })
  }

  enqueue<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    this.assertActive()
    const count = (this.queuedCounts.get(key) ?? 0) + 1
    if (count > MAX_QUEUED_NAMESPACE_OPERATIONS) {
      throw new Error('terminal authority app outcome queue capacity exceeded')
    }
    this.queuedCounts.set(key, count)
    const previous = this.queues.get(key) ?? Promise.resolve()
    const result = previous.then(() => {
      this.assertActive()
      return operation()
    })
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(key, tail)
    void tail.then(() => {
      this.queuedCounts.set(key, Math.max(0, (this.queuedCounts.get(key) ?? 1) - 1))
      if (this.queues.get(key) === tail) {
        this.queues.delete(key)
      }
    })
    return result
  }

  async settle<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    this.assertActive()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<Settlement<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
      timer.unref?.()
    })
    const result = await Promise.race<Settlement<T>>([
      operation.then(
        (value) => ({ kind: 'value', value }),
        (error) => ({ kind: 'error', error })
      ),
      this.canceled.then(() => ({ kind: 'canceled' })),
      timeout
    ])
    if (timer) {
      clearTimeout(timer)
    }
    if (result.kind === 'value') {
      return result.value
    }
    if (result.kind === 'error') {
      throw result.error
    }
    if (result.kind === 'timeout') {
      throw new Error(`terminal authority app outcome ${label} settlement timed out`)
    }
    throw new Error('terminal authority app outcome connection generation was canceled')
  }

  async waitForPending<T>(operation: Promise<T>): Promise<T> {
    this.assertActive()
    const result = await Promise.race<Settlement<T>>([
      operation.then(
        (value) => ({ kind: 'value', value }),
        (error) => ({ kind: 'error', error })
      ),
      this.canceled.then(() => ({ kind: 'canceled' }))
    ])
    if (result.kind === 'value') {
      return result.value
    }
    if (result.kind === 'error') {
      throw result.error
    }
    throw new Error('terminal authority app outcome connection generation was canceled')
  }

  async waitBeforeReconnect(delayMs: number): Promise<boolean> {
    this.assertActive()
    let timer: ReturnType<typeof setTimeout> | undefined
    const elapsed = new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), delayMs)
      timer.unref?.()
    })
    const result = await Promise.race([elapsed, this.canceled.then(() => false)])
    if (timer) {
      clearTimeout(timer)
    }
    return result
  }

  cancel(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.cancelGeneration()
    this.queues.clear()
    this.queuedCounts.clear()
  }

  private assertActive(): void {
    if (!this.active) {
      throw new Error('terminal authority app outcome connection generation was canceled')
    }
  }
}
