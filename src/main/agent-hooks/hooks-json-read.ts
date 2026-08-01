import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { HooksConfig } from './installer-utils'

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type HooksJsonSnapshot = {
  /** null when the file does not exist or could not be read. */
  raw: string | null
  config: HooksConfig | null
}

// Why: fresh objects per call — callers mutate the returned config in place.
function missingConfig(): HooksJsonSnapshot {
  return { raw: null, config: {} }
}

function unreadableConfig(): HooksJsonSnapshot {
  return { raw: null, config: null }
}

function parseHooksJsonSnapshot(raw: string): HooksJsonSnapshot {
  try {
    const parsed = JSON.parse(raw)
    return { raw, config: isPlainObject(parsed) ? parsed : null }
  } catch {
    return { raw, config: null }
  }
}

// Why: generation guards abort a mutation when the file no longer matches the
// bytes it was derived from; the raw snapshot and the parse must come from one
// read or a concurrent save can slip between them unnoticed.
export function readHooksJsonWithRaw(configPath: string): HooksJsonSnapshot {
  if (!existsSync(configPath)) {
    return missingConfig()
  }
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch {
    return unreadableConfig()
  }
  return parseHooksJsonSnapshot(raw)
}

export function readHooksJson(configPath: string): HooksConfig | null {
  return readHooksJsonWithRaw(configPath).config
}

// Why: main-thread twin of readHooksJsonWithRaw. The existsSync probe is gone —
// ENOENT from the single read carries the same answer, and one syscall instead
// of two is what matters when HOME sits on a stalled network mount.
async function readHooksJsonWithRawAsync(configPath: string): Promise<HooksJsonSnapshot> {
  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? missingConfig() : unreadableConfig()
  }
  return parseHooksJsonSnapshot(raw)
}

export async function readHooksJsonAsync(configPath: string): Promise<HooksConfig | null> {
  return (await readHooksJsonWithRawAsync(configPath)).config
}
