import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Why the compiled tree's own package.json: the CLI runs under
 * ELECTRON_RUN_AS_NODE, which bypasses Electron's asar integration, so the
 * app's real package.json inside app.asar is unreadable and `app.getVersion()`
 * does not exist. `out/package.json` is already unpacked beside the CLI, and
 * packaging stamps the effective build version into it.
 */
export function readOrcaCliVersion(runtimeDir = __dirname): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(runtimeDir, '..', 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : null
  } catch {
    return null
  }
}

/** True for the argv shapes that should print the version and exit. */
export function argvRequestsVersion(argv: string[]): boolean {
  return argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')
}
