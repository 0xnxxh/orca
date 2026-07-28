type GateWaiter = {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export type WorktreeScanOperation<T> = {
  result: Promise<T>
  settled?: Promise<unknown>
}

export type TrackedWorktreeScanOperation<T> = {
  result: Promise<T>
  settled: Promise<unknown>
}

function abortError(): Error {
  const error = new Error('Worktree scan was cancelled before it started.')
  error.name = 'AbortError'
  return error
}

/** Keep the async contract: failures reject `result` instead of throwing at the call site. */
function failedOperation<T>(error: unknown): TrackedWorktreeScanOperation<T> {
  const result = Promise.reject<T>(error)
  // Why: a caller may consume only `settled`; an unconsumed rejection would surface as unhandled.
  void result.catch(() => {})
  return { result, settled: Promise.resolve() }
}

export class WorktreeScanGate {
  private active = 0
  private readonly waiters: GateWaiter[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Worktree scan concurrency must be a positive integer.')
    }
  }

  run<T>(start: () => WorktreeScanOperation<T>, acquisitionSignal?: AbortSignal): Promise<T> {
    return this.runTracked(start, acquisitionSignal).result
  }

  runTracked<T>(
    start: () => WorktreeScanOperation<T>,
    acquisitionSignal?: AbortSignal
  ): TrackedWorktreeScanOperation<T> {
    if (acquisitionSignal?.aborted) {
      return failedOperation<T>(abortError())
    }
    if (this.active < this.limit) {
      this.active += 1
      const release = this.createRelease()
      try {
        return this.startOperation(start, release)
      } catch (error) {
        return failedOperation<T>(error)
      }
    }
    const acquisition = this.acquire(acquisitionSignal)
    const operation = acquisition.then((release) => {
      if (acquisitionSignal?.aborted) {
        release()
        throw abortError()
      }
      return this.startOperation(start, release)
    })
    return {
      result: operation.then((tracked) => tracked.result),
      settled: operation.then(
        (tracked) =>
          tracked.settled.then(
            () => undefined,
            () => undefined
          ),
        () => undefined
      )
    }
  }

  private startOperation<T>(
    start: () => WorktreeScanOperation<T>,
    release: () => void
  ): TrackedWorktreeScanOperation<T> {
    let operation: WorktreeScanOperation<T>
    try {
      operation = start()
    } catch (error) {
      release()
      throw error
    }
    const settled = operation.settled ?? operation.result
    void settled.then(release, release)
    return { result: operation.result, settled }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(abortError())
    }
    return new Promise((resolve, reject) => {
      const waiter: GateWaiter = { resolve, reject, signal }
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index === -1) {
            return
          }
          this.waiters.splice(index, 1)
          reject(abortError())
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  private createRelease(): () => void {
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.active -= 1
      this.startNext()
    }
  }

  private startNext(): void {
    while (this.active < this.limit) {
      const waiter = this.waiters.shift()
      if (!waiter) {
        return
      }
      if (waiter.onAbort) {
        waiter.signal?.removeEventListener('abort', waiter.onAbort)
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortError())
        continue
      }
      this.active += 1
      waiter.resolve(this.createRelease())
    }
  }
}
