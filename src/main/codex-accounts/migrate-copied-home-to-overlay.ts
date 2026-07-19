import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CodexManagedAccount } from '../../shared/types'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { writeFileAtomically } from './fs-utils'
import { assertOwnedHostCodexManagedHomePath } from './host-codex-managed-home-ownership'
import { syncSystemCodexOverlayResourcesIntoManagedHome } from '../codex/codex-overlay-home-paths'
import { grantManagedCodexOverlayHookTrust } from './overlay-hook-trust'
import {
  createTomlLineScanState,
  getTomlTableHeader,
  isTomlStructuralLine,
  updateTomlLineScanState
} from '../codex/config-toml-line-scan'
import {
  normalizeCodexProjectPathForLookup,
  parseCodexProjectHeaderPath,
  upsertProjectTrustLevelInContent,
  type CodexProjectTrustLevel
} from '../codex/config-toml-trust'

// Why: existing per-account homes from the copy era hold a REAL config.toml that
// diverged from ~/.codex. This one-shot, flag-gated, recoverable migration keeps
// every real per-account file (auth.json, models_cache.json, .credentials.json,
// sessions/, sqlite), promotes user PROJECT trust the copy accumulated into the
// shared real config ONCE, then converts config.toml + hooks.json + resources to
// overlay symlinks and re-grants hook trust. The copied config is archived first
// so the pre-migration state stays recoverable through soak.
export const COPIED_HOME_OVERLAY_MIGRATION_MARKER = 'per-account-overlay-migration-v1.json'

type CopiedHomeOverlayMigrationOptions = {
  hostAccounts: readonly CodexManagedAccount[]
  managedAccountsRoot: string
  metadataDir: string
  systemCodexHome: string
}

export function migrateCopiedManagedHomesToOverlay({
  hostAccounts,
  managedAccountsRoot,
  metadataDir,
  systemCodexHome
}: CopiedHomeOverlayMigrationOptions): void {
  const markerPath = join(metadataDir, COPIED_HOME_OVERLAY_MIGRATION_MARKER)
  if (existsSync(markerPath)) {
    return
  }

  const archiveRoot = join(metadataDir, 'copied-home-overlay-archive')
  const migrated: string[] = []
  for (const account of hostAccounts) {
    if (parseWslUncPath(account.managedHomePath)) {
      continue
    }
    try {
      if (migrateAccountHomeToOverlay(account, managedAccountsRoot, systemCodexHome, archiveRoot)) {
        migrated.push(account.id)
      }
    } catch (error) {
      // Why: one account's failure must not block the others or the marker; a
      // still-copied home just retries structural conversion at the next launch
      // via the overlay sync, and the marker below prevents re-promotion churn.
      console.warn('[codex-overlay-migration] Failed to migrate account home:', account.id, error)
    }
  }

  writeFileAtomically(
    markerPath,
    `${JSON.stringify({ completedAt: Date.now(), migratedAccountIds: migrated }, null, 2)}\n`,
    { mode: 0o600 }
  )
}

function migrateAccountHomeToOverlay(
  account: CodexManagedAccount,
  managedAccountsRoot: string,
  systemCodexHome: string,
  archiveRoot: string
): boolean {
  const trustedHome = assertOwnedHostCodexManagedHomePath({
    candidatePath: account.managedHomePath,
    managedAccountsRoot,
    systemCodexHomePath: systemCodexHome,
    expectedAccountId: account.id
  })
  const configPath = join(trustedHome, 'config.toml')
  const configIsCopiedRegularFile = pathIsRegularFile(configPath)

  if (configIsCopiedRegularFile) {
    // Why: archive the copied config first so the pre-migration state is
    // recoverable through soak before we replace it with a symlink.
    archiveCopiedConfig(archiveRoot, account.id, configPath)
    promoteCopiedProjectTrustToRealConfig(
      readFileSync(configPath, 'utf-8'),
      join(systemCodexHome, 'config.toml')
    )
  }

  // Why: convert config.toml + hooks.json + resource copies to overlay symlinks
  // (self-heals the copied config to a link), or warn + mark stale on stock
  // Windows. Then re-grant this overlay's hook trust into the shared real config.
  syncSystemCodexOverlayResourcesIntoManagedHome(trustedHome, systemCodexHome)
  grantManagedCodexOverlayHookTrust(trustedHome)
  return configIsCopiedRegularFile
}

function pathIsRegularFile(candidatePath: string): boolean {
  try {
    return lstatSync(candidatePath).isFile()
  } catch {
    return false
  }
}

function archiveCopiedConfig(archiveRoot: string, accountId: string, configPath: string): void {
  const archivePath = join(archiveRoot, accountId, 'config.toml')
  if (existsSync(archivePath)) {
    return
  }
  mkdirSync(dirname(archivePath), { recursive: true })
  copyFileSync(configPath, archivePath)
}

// Why: only promote a project decision the copied home accumulated when the real
// config has NO entry for that project, so a user's later real-config decision is
// never overridden and a revocation is never resurrected.
function promoteCopiedProjectTrustToRealConfig(copiedConfig: string, realConfigPath: string): void {
  const copiedEntries = collectProjectTrustEntries(copiedConfig)
  if (copiedEntries.size === 0) {
    return
  }
  let realConfig = existsSync(realConfigPath) ? readFileSync(realConfigPath, 'utf-8') : ''
  const realProjects = new Set(collectProjectTrustEntries(realConfig).keys())
  let changed = false
  for (const [lookupKey, entry] of copiedEntries) {
    if (realProjects.has(lookupKey)) {
      continue
    }
    // Why: the copied project paths were already canonicalized by codex when it
    // wrote them, so keep them verbatim instead of realpath-resolving again.
    realConfig = upsertProjectTrustLevelInContent(realConfig, entry.projectPath, entry.trustLevel, {
      alreadyCanonical: true
    })
    changed = true
  }
  if (changed) {
    writeFileAtomically(realConfigPath, realConfig)
  }
}

type ProjectTrustEntry = { projectPath: string; trustLevel: CodexProjectTrustLevel }

function collectProjectTrustEntries(config: string): Map<string, ProjectTrustEntry> {
  const lines = config.split('\n')
  const entries = new Map<string, ProjectTrustEntry>()
  let scanState = createTomlLineScanState()
  let currentProjectPath: string | null = null
  let currentBlockLines: string[] = []

  const flush = (): void => {
    if (currentProjectPath === null) {
      return
    }
    const level = readBlockTrustLevel(currentBlockLines.join('\n'))
    if (level !== null) {
      entries.set(normalizeCodexProjectPathForLookup(currentProjectPath), {
        projectPath: currentProjectPath,
        trustLevel: level
      })
    }
  }

  for (const line of lines) {
    const header = isTomlStructuralLine(scanState) ? getTomlTableHeader(line) : null
    if (header) {
      flush()
      currentProjectPath = parseCodexProjectHeaderPath(header)
      currentBlockLines = []
    } else if (currentProjectPath !== null) {
      currentBlockLines.push(line)
    }
    scanState = updateTomlLineScanState(scanState, line)
  }
  flush()
  return entries
}

function readBlockTrustLevel(block: string): CodexProjectTrustLevel | null {
  const match =
    /^[ \t]*trust_level[ \t]*=[ \t]*(?:"(trusted|untrusted)"|'(trusted|untrusted)')[ \t\r]*(?:#.*)?$/m.exec(
      block
    )
  const level = match?.[1] ?? match?.[2] ?? null
  return level === 'trusted' || level === 'untrusted' ? level : null
}
