import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isSafeFishHistorySession } from './fish-history-session'

const execFileAsync = promisify(execFile)
const MAX_CONCURRENT_CLEANUPS = 4
const MAX_QUEUED_CLEANUPS = 64
type CleanupJob = {
  key: string
  distro: string
  session: string
  run: typeof execFileAsync
  resolve: () => void
  reject: (error: unknown) => void
}

let activeCleanups = 0
const queuedCleanups: CleanupJob[] = []
const cleanupPromises = new Map<string, Promise<void>>()

function pumpCleanupQueue(): void {
  while (activeCleanups < MAX_CONCURRENT_CLEANUPS && queuedCleanups.length > 0) {
    const job = queuedCleanups.shift()
    if (!job) {
      return
    }
    activeCleanups++
    void job
      .run(
        'wsl.exe',
        [
          '--distribution',
          job.distro,
          '--exec',
          'fish',
          '--command',
          fishCleanupScript(job.session)
        ],
        {
          timeout: 5_000,
          windowsHide: true
        }
      )
      .then(
        () => job.resolve(),
        (error: unknown) => job.reject(error)
      )
      .finally(() => {
        activeCleanups--
        cleanupPromises.delete(job.key)
        pumpCleanupQueue()
      })
  }
}

function fishCleanupScript(session: string): string {
  return [
    'set -l data_home $XDG_DATA_HOME',
    'string match -qr "^/" -- $data_home; or set data_home "$HOME/.local/share"',
    `command rm -f -- "$data_home/fish/${session}_history"`
  ].join('; ')
}

export function deleteWslFishHistoryFile(
  distro: string,
  session: string,
  run: typeof execFileAsync = execFileAsync
): Promise<void> {
  if (!distro.trim() || !isSafeFishHistorySession(session)) {
    return Promise.resolve()
  }
  const key = `${distro}\0${session}`
  const existing = cleanupPromises.get(key)
  if (existing) {
    return existing
  }
  if (queuedCleanups.length >= MAX_QUEUED_CLEANUPS) {
    return Promise.reject(new Error('WSL Fish history cleanup queue is full'))
  }
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const cleanup = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  cleanupPromises.set(key, cleanup)
  queuedCleanups.push({ key, distro, session, run, resolve, reject })
  pumpCleanupQueue()
  return cleanup
}

/** Drain queued and active cleanups; intended for deterministic shutdown/test cleanup. */
export async function flushWslFishHistoryCleanups(): Promise<void> {
  while (queuedCleanups.length > 0 || activeCleanups > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
