const MAX_CONCURRENT_WSL_TRANSCRIPT_FS_TASKS = 1

let activeTaskCount = 0
const permitWaiters: (() => void)[] = []
const inFlightTasks = new Map<string, Promise<unknown>>()

function acquirePermit(): Promise<void> {
  if (activeTaskCount < MAX_CONCURRENT_WSL_TRANSCRIPT_FS_TASKS) {
    activeTaskCount += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => permitWaiters.push(resolve))
}

function releasePermit(): void {
  const next = permitWaiters.shift()
  if (next) {
    next()
    return
  }
  activeTaskCount -= 1
}

/** Keep stopped-distro 9P work from exhausting libuv's shared filesystem pool. */
export function runWslTranscriptFsTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  return shareWslTranscriptFsTask(key, async () => {
    await acquirePermit()
    try {
      return await task()
    } finally {
      releasePermit()
    }
  })
}

/** Share a multi-read WSL operation without holding one permit for its lifetime. */
export function shareWslTranscriptFsTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightTasks.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }

  const pending = task()
  inFlightTasks.set(key, pending)

  const clear = (): void => {
    if (inFlightTasks.get(key) === pending) {
      inFlightTasks.delete(key)
    }
  }
  void pending.then(clear, clear)
  return pending
}
