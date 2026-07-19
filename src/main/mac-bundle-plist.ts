import { execFile, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PLUTIL_PATH = '/usr/bin/plutil'
const PLUTIL_TIMEOUT_MS = 2_000
const PLUTIL_MAX_BUFFER = 16 * 1024
const VALUE_MAX_LENGTH = 128

// Why: the update fence's gate, monitor, and CLI all read Info.plist keys via
// plutil; one reader keeps their timeout, size, and failure semantics aligned.
export async function readMacBundlePlistValue(
  bundlePath: string,
  key: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(PLUTIL_PATH, plutilArguments(bundlePath, key), {
      encoding: 'utf8',
      timeout: PLUTIL_TIMEOUT_MS,
      maxBuffer: PLUTIL_MAX_BUFFER
    })
    return normalizePlistValue(stdout)
  } catch {
    return null
  }
}

export function readMacBundlePlistValueSync(bundlePath: string, key: string): string | null {
  try {
    const stdout = execFileSync(PLUTIL_PATH, plutilArguments(bundlePath, key), {
      encoding: 'utf8',
      timeout: PLUTIL_TIMEOUT_MS,
      maxBuffer: PLUTIL_MAX_BUFFER
    })
    return normalizePlistValue(stdout)
  } catch {
    return null
  }
}

function plutilArguments(bundlePath: string, key: string): string[] {
  return ['-extract', key, 'raw', '-o', '-', join(bundlePath, 'Contents', 'Info.plist')]
}

function normalizePlistValue(stdout: string): string | null {
  const value = stdout.trim()
  return value.length > 0 && value.length <= VALUE_MAX_LENGTH ? value : null
}
