import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RELAY_VERSION } from './protocol'

// Why: launch cwd is arbitrary, while the deployed .version sits beside the resolved relay script.
export function readLaunchVersion(): string {
  try {
    const entry = process.argv[1]
    let directory: string
    if (entry) {
      let resolved = entry
      try {
        resolved = realpathSync(entry)
      } catch {
        // Fall back to the unresolved entry path.
      }
      directory = dirname(resolved)
    } else {
      directory = process.cwd()
    }
    const versionFile = join(directory, '.version')
    if (existsSync(versionFile)) {
      const version = readFileSync(versionFile, 'utf8').trim()
      if (version) {
        return version
      }
    }
  } catch {
    // Fall back to the embedded protocol version.
  }
  return RELAY_VERSION
}
