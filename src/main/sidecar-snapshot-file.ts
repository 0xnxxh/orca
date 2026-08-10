// Why a sidecar next to orca-data.json: scan snapshots rewrite wholesale and can reach hundreds
// of KB; folding them into orca-data.json would rewrite the whole state file per scan (the
// githubCache sidecar precedent). Best-effort by design: a lost snapshot only costs a rescan.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from './durable-file-write'
import { getCanonicalUserDataPath } from './persistence'

const queues = new Map<string, Promise<unknown>>()

export function sidecarSnapshotFile(fileName: string): string {
  return join(getCanonicalUserDataPath(), fileName)
}

/** Serialize tasks per sidecar so read-modify-write patch/prune cycles cannot interleave. */
export function withSidecarSnapshotQueue<T>(fileName: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(fileName) ?? Promise.resolve()
  const run = previous.then(task, task)
  queues.set(
    fileName,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

/** Parsed sidecar contents, or null when the file is missing or not valid JSON. */
export async function readSidecarSnapshot(fileName: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(sidecarSnapshotFile(fileName), 'utf-8')) as unknown
  } catch {
    return null
  }
}

export async function writeSidecarSnapshot(fileName: string, payload: unknown): Promise<void> {
  const file = sidecarSnapshotFile(fileName)
  await writeFileDurable(durableWriteTempPath(file), file, JSON.stringify(payload))
}
