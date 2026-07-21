import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getOrcaUserDataPath } from './codex-home-paths'

/** Session roots of per-account self-contained host Codex homes present on disk.
 *  Why disk-enumerated, not settings-driven: rollouts retained after an account
 *  change must still be counted, and CLI callers have no settings store. WSL
 *  account homes live inside their distro and are scanned by their own lane. */
export function getCodexAccountHomeSessionDirectories(): string[] {
  const accountsRoot = join(getOrcaUserDataPath(), 'codex-accounts')
  try {
    return readdirSync(accountsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(accountsRoot, entry.name, 'home', 'sessions'))
      .filter((sessionsPath) => existsSync(sessionsPath))
  } catch {
    return []
  }
}
