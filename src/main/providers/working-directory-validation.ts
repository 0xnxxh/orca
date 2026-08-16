// Validates a PTY working directory before spawn, so node-pty cannot fail with
// an opaque ENOENT. Split from local-pty-utils to keep that file under its line
// cap; the async path carries the cancellation contract described below.

import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { release } from 'node:os'
import { isWslUncPath } from '../../shared/wsl-paths'
import { wslUncDirectoryExists, wslUncDirectoryExistsAsync } from '../wsl'

const pendingWorkingDirectoryValidations = new Map<string, Promise<void>>()

/** Thrown when the caller gave up on a probe that is still running. */
export class WorkingDirectoryValidationAbortedError extends Error {
  constructor(cwd: string) {
    super(`Working directory validation for "${cwd}" was canceled.`)
    this.name = 'WorkingDirectoryValidationAbortedError'
  }
}

export function formatLocalPtyEnvironmentDiag(extra: Record<string, string> = {}): string {
  const systemVersion =
    (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion?.() ||
    release()
  const parts = {
    ...extra,
    arch: process.arch,
    platform: `${process.platform} ${systemVersion}`,
    orca: process.env.ORCA_APP_VERSION?.trim() || '0.0.0-dev'
  }
  return Object.entries(parts)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
}

function throwMissingWorkingDirectory(cwd: string): never {
  throw new Error(
    `Working directory "${cwd}" does not exist. ` +
      `It may have been deleted or is on an unmounted volume ` +
      `(${formatLocalPtyEnvironmentDiag({ cwd })}).`
  )
}

/**
 * Validate that a working directory exists and is a directory.
 * Throws a descriptive Error if not.
 */
export function validateWorkingDirectory(cwd: string): void {
  // Why: Win32 fs.statSync against the WSL 9P share (\\wsl.localhost\...) can
  // falsely report ENOENT for directories that exist on the Linux side. Ask the
  // distro itself; only fall back to the fs check when wsl.exe is inconclusive.
  if (isWslUncPath(cwd)) {
    const existsInDistro = wslUncDirectoryExists(cwd)
    if (existsInDistro === false) {
      throwMissingWorkingDirectory(cwd)
    }
    if (existsInDistro === true) {
      return
    }
  }

  if (!existsSync(cwd)) {
    throwMissingWorkingDirectory(cwd)
  }
  if (!statSync(cwd).isDirectory()) {
    throw new Error(`Working directory "${cwd}" is not a directory.`)
  }
}

/**
 * Validate a cwd without blocking the daemon's shared event loop.
 *
 * `fs.stat` takes no AbortSignal and a dead SMB/NFS mount can hang it for
 * minutes, so an aborted caller abandons the shared probe rather than
 * interrupting it: the probe stays shared for whoever is still waiting, and the
 * caller stops holding a create in flight.
 */
export function validateWorkingDirectoryAsync(
  cwd: string,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const key = cwd
  let validation = pendingWorkingDirectoryValidations.get(key)
  if (!validation) {
    validation = validateWorkingDirectoryUncached(cwd)
    pendingWorkingDirectoryValidations.set(key, validation)
    const started = validation
    // Why: dropped only on settle. `fs.stat` is uninterruptible, so retiring a
    // still-running probe on a timer frees no libuv thread — it only lets the
    // next caller pin a second one, and a few retries against one dead mount
    // exhaust the default pool of 4 and stall every other async fs read in the
    // daemon. Callers escape through `signal` instead, so sharing one hung probe
    // no longer strands them.
    const forget = (): void => {
      if (pendingWorkingDirectoryValidations.get(key) === started) {
        pendingWorkingDirectoryValidations.delete(key)
      }
    }
    void validation.then(forget, forget)
  }
  const signal = options.signal
  if (!signal) {
    return validation
  }
  const shared = validation
  // The shared probe outlives this caller; keep it from surfacing as unhandled.
  void shared.catch(() => {})
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(new WorkingDirectoryValidationAbortedError(cwd))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function validateWorkingDirectoryUncached(cwd: string): Promise<void> {
  if (isWslUncPath(cwd)) {
    const existsInDistro = await wslUncDirectoryExistsAsync(cwd)
    if (existsInDistro === false) {
      throwMissingWorkingDirectory(cwd)
    }
    if (existsInDistro === true) {
      return
    }
  }

  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(cwd)
  } catch {
    // One stat avoids paying an unreachable filesystem timeout twice.
    throwMissingWorkingDirectory(cwd)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Working directory "${cwd}" is not a directory.`)
  }
}
