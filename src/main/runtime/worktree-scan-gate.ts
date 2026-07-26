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

function abortError(): Error {
  const error = new Error('Worktree scan was cancelled before it started.')
  error.name = 'AbortError'
  return error
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
    if (acquisitionSignal?.aborted) {
      return Promise.reject(abortError())
    }
    if (this.active < this.limit) {
      this.active += 1
      return this.startOperation(start, this.createRelease())
    }
    return this.acquire(acquisitionSignal).then((release) => this.startOperation(start, release))
  }

  private startOperation<T>(
    start: () => WorktreeScanOperation<T>,
    release: () => void
  ): Promise<T> {
    let operation: WorktreeScanOperation<T>
    try {
      operation = start()
    } catch (error) {
      release()
      throw error
    }
    void (operation.settled ?? operation.result).then(release, release)
    return operation.result
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
