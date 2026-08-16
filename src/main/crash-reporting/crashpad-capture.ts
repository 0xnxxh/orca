// Starts Electron's Crashpad handler and pairs a written minidump with the
// `render-process-gone` / `child-process-gone` event that reported the death.
//
// Upload stays off: dumps contain process memory, and the only transport we
// have (observability/diagnostic-bundle-upload) is a user-initiated 4 MiB text
// bundle. We keep dumps on disk and lift the *text* signature out of them, so
// a CHECK failure becomes nameable without shipping raw memory anywhere.

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { app, crashReporter } from 'electron'
import {
  parseMinidumpCrashSignature,
  type MinidumpCrashSignature
} from './minidump-crash-signature'

// Why: Crashpad writes the dump from the handler process while Electron
// delivers process-gone on the main thread; the two race. Poll a short window
// rather than sampling once and losing the dump most of the time.
const DUMP_WAIT_TIMEOUT_MS = 8_000
const DUMP_POLL_INTERVAL_MS = 250
// A dump older than this belongs to an earlier crash, not the one we're pairing.
const DUMP_RECENCY_WINDOW_MS = 30_000
// Renderer dumps run ~1-15 MiB; well past that means we mis-picked a file.
const MAX_DUMP_BYTES = 64 * 1024 * 1024

type DumpCandidate = {
  readonly filePath: string
  readonly mtimeMs: number
  readonly size: number
}

// Why: `app.getPath('crashDumps')` is derived from userData, which shifts when
// app.setName runs at whenReady. Snapshot where Crashpad was actually pointed.
let crashpadDumpDirectory: string | null = null
let captureStarted = false

export type CrashpadCaptureOptions = {
  /** Overrides Electron's default so tests need no real Crashpad handler. */
  readonly dumpDirectory?: string
}

/**
 * Must run before `app.whenReady()`. Safe to call twice; the second call is a
 * no-op so a re-entrant startup path cannot restart the handler.
 */
export function startCrashpadCapture(options: CrashpadCaptureOptions = {}): boolean {
  if (captureStarted) {
    return true
  }
  try {
    crashReporter.start({
      // Why: no submitURL is configured anywhere, and uploadToServer:true with
      // an unset URL makes Crashpad retry against a bogus endpoint forever.
      uploadToServer: false,
      // Keep the OS handler (WER / Apple crash reporter) in the loop; it costs
      // nothing and is the only signal left if Crashpad itself fails to init.
      ignoreSystemCrashHandler: false,
      compress: false
    })
    captureStarted = true
  } catch (error) {
    console.error('[crash-reporting] Crashpad start failed:', error)
    return false
  }
  crashpadDumpDirectory = options.dumpDirectory ?? resolveDumpDirectory()
  return true
}

function resolveDumpDirectory(): string | null {
  try {
    return app.getPath('crashDumps')
  } catch {
    return null
  }
}

export function getCrashpadDumpDirectory(): string | null {
  return crashpadDumpDirectory
}

/** Test seam; production callers go through startCrashpadCapture. */
export function _setCrashpadCaptureStateForTest(
  state: { dumpDirectory: string | null; started: boolean } | null
): void {
  crashpadDumpDirectory = state?.dumpDirectory ?? null
  captureStarted = state?.started ?? false
}

async function collectDumpCandidates(directory: string): Promise<DumpCandidate[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, {
      withFileTypes: true,
      recursive: true
    })
  } catch {
    return []
  }
  const candidates: DumpCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.dmp')) {
      continue
    }
    // `recursive` yields nested names relative to parentPath, not directory.
    const filePath = path.join(entry.parentPath ?? directory, entry.name)
    try {
      const stats = await stat(filePath)
      candidates.push({ filePath, mtimeMs: stats.mtimeMs, size: stats.size })
    } catch {
      // Crashpad renames dumps as it promotes them; a vanished file is normal.
    }
  }
  return candidates
}

/**
 * Waits for the dump Crashpad writes for a crash observed at `crashedAtMs`.
 * Resolves null when capture is off, the handler wrote nothing, or the only
 * dumps on disk predate this crash.
 */
export async function waitForCrashMinidump(
  crashedAtMs: number,
  options: {
    timeoutMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {}
): Promise<DumpCandidate | null> {
  const directory = crashpadDumpDirectory
  if (!directory) {
    return null
  }
  const timeoutMs = options.timeoutMs ?? DUMP_WAIT_TIMEOUT_MS
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  // Why: a dump can land microseconds before Electron delivers process-gone,
  // so the floor has to sit behind the observed crash time, not on it.
  const floorMs = crashedAtMs - DUMP_RECENCY_WINDOW_MS
  const deadline = now() + timeoutMs

  for (;;) {
    const fresh = (await collectDumpCandidates(directory))
      .filter((candidate) => candidate.mtimeMs >= floorMs && candidate.size <= MAX_DUMP_BYTES)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    if (fresh.length > 0) {
      return fresh[0]
    }
    if (now() >= deadline) {
      return null
    }
    await sleep(DUMP_POLL_INTERVAL_MS)
  }
}

export type CapturedMinidump = {
  readonly filePath: string
  readonly sizeBytes: number
  readonly signature: MinidumpCrashSignature
}

/** Finds the dump for a crash and parses its signature. Never throws. */
export async function captureMinidumpSignature(
  crashedAtMs: number,
  options: Parameters<typeof waitForCrashMinidump>[1] = {}
): Promise<CapturedMinidump | null> {
  try {
    const dump = await waitForCrashMinidump(crashedAtMs, options)
    if (!dump) {
      return null
    }
    const signature = parseMinidumpCrashSignature(await readFile(dump.filePath))
    if (!signature) {
      return null
    }
    return { filePath: dump.filePath, sizeBytes: dump.size, signature }
  } catch (error) {
    console.error('[crash-reporting] minidump signature capture failed:', error)
    return null
  }
}
