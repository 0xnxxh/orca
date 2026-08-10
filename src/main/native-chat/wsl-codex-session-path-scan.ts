import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { walkSessionFiles } from '../ai-vault/session-scanner-discovery'
import { runWslTranscriptFsTask } from './wsl-transcript-fs-gate'

type ScanGeneration = {
  controller: AbortController
  promise: Promise<string[]>
  settled: boolean
  waiterCount: number
}

const inFlightScans = new Map<string, ScanGeneration>()

function readDirectory(dirPath: string, signal: AbortSignal): Promise<Dirent[]> {
  return runWslTranscriptFsTask(
    { operation: 'readdir', path: dirPath, priority: 'scan', signal },
    () => readdir(dirPath, { withFileTypes: true })
  )
}

function startScan(root: string): ScanGeneration {
  const controller = new AbortController()
  const scan: ScanGeneration = {
    controller,
    promise: walkSessionFiles(root, 'codex', [], {
      extensions: new Set(['.jsonl']),
      readDirectory: (dirPath) => readDirectory(dirPath, controller.signal),
      signal: controller.signal
    }),
    settled: false,
    waiterCount: 0
  }
  inFlightScans.set(root, scan)
  const clear = (): void => {
    scan.settled = true
    if (inFlightScans.get(root) === scan) {
      inFlightScans.delete(root)
    }
  }
  void scan.promise.then(clear, clear)
  return scan
}

function waitForScan(scan: ScanGeneration, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted()
  scan.waiterCount += 1
  let onAbort: (() => void) | undefined
  const aborted = signal
    ? new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('Codex session scan aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
    : null
  return Promise.race(aborted ? [scan.promise, aborted] : [scan.promise]).finally(() => {
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
    scan.waiterCount -= 1
    if (!scan.settled && scan.waiterCount === 0) {
      scan.controller.abort()
    }
  })
}

async function scanRoot(
  root: string,
  signal?: AbortSignal
): Promise<{ paths: string[]; joined: boolean }> {
  signal?.throwIfAborted()
  const existing = inFlightScans.get(root)
  const scan = existing ?? startScan(root)
  return { paths: await waitForScan(scan, signal), joined: Boolean(existing) }
}

function findSessionPath(paths: string[], sessionId: string): string | null {
  return (
    paths.find((path) => {
      const name = basename(path, extname(path))
      return name === sessionId || name.endsWith(`-${sessionId}`)
    }) ?? null
  )
}

/** Share tree discovery, then refresh a shared miss for post-start file creation. */
export async function findWslCodexSessionPath(
  root: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<string | null> {
  const first = await scanRoot(root, signal)
  const firstHit = findSessionPath(first.paths, sessionId)
  if (firstHit || !first.joined) {
    return firstHit
  }
  const refreshed = await scanRoot(root, signal)
  return findSessionPath(refreshed.paths, sessionId)
}
