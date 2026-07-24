import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readAgentStateFileSync } from '../agent-state-file-reader'
import { getOrcaManagedCodexHomePath, getSystemCodexHomePath } from './codex-home-paths'
import type { CodexSettingsPromotionHomes } from './config-settings-promotion'
import type {
  CodexConfigSyncStallReason,
  CodexConfigSyncStatus
} from '../../shared/codex-config-sync-types'

// Why: the mirror preserves the managed runtime config when ~/.codex/config.toml
// is missing or blank, which is silent by design — but the stall can persist for
// every launch (a downed WSL distro, an unhydrated cloud-synced home), leaving
// "Orca ignores my config edits" with nothing to diagnose. Derived on demand from
// the same predicates the mirror uses so the two can never disagree.
export function getCodexConfigSyncStatus(
  homes: CodexSettingsPromotionHomes = {
    runtimeHomePath: getOrcaManagedCodexHomePath(),
    systemHomePath: getSystemCodexHomePath()
  }
): CodexConfigSyncStatus {
  const systemConfigPath = join(homes.systemHomePath, 'config.toml')
  const runtimeConfigPath = join(homes.runtimeHomePath, 'config.toml')
  // Why: a stall only withholds settings once a managed runtime config exists;
  // without one the mirror seeds it and there is nothing yet to fall behind.
  if (!existsSync(runtimeConfigPath)) {
    return { state: 'synced', reason: null, systemConfigPath }
  }
  if (!existsSync(systemConfigPath)) {
    return { state: 'stalled', reason: 'missing-source', systemConfigPath }
  }
  let rawSystemConfig: string
  try {
    rawSystemConfig = readAgentStateFileSync(systemConfigPath)
  } catch {
    // Why: the mirror aborts on an unreadable source too, so report the stall
    // rather than claiming a sync that cannot happen.
    return { state: 'stalled', reason: 'unreadable-source', systemConfigPath }
  }
  if (rawSystemConfig.trim() === '') {
    return { state: 'stalled', reason: 'blank-source', systemConfigPath }
  }
  return { state: 'synced', reason: null, systemConfigPath }
}

// Why: the mirror runs on every launch and on the quota poll, so logging each
// skip would bury the log. Latch per home and log the transition instead, so an
// ongoing stall stays one line and a recovery is visible.
const stalledHomes = new Map<string, CodexConfigSyncStallReason>()

export function reportCodexConfigSyncOutcome(
  runtimeHomePath: string,
  status: CodexConfigSyncStatus
): void {
  const previousReason = stalledHomes.get(runtimeHomePath)
  if (status.state === 'synced') {
    if (previousReason) {
      stalledHomes.delete(runtimeHomePath)
      console.warn(
        `[codex-config] Config sync recovered for ${runtimeHomePath}; ${status.systemConfigPath} is readable again.`
      )
    }
    return
  }
  if (previousReason === status.reason) {
    return
  }
  stalledHomes.set(runtimeHomePath, status.reason)
  console.warn(
    `[codex-config] Config sync stalled (${status.reason}): ${status.systemConfigPath} is unusable, so ${runtimeHomePath} keeps its last synced settings. Edits to the source will not apply until it is readable.`
  )
}

// Why: the latch is module state, so suites that assert on transitions need a
// clean slate between cases.
export function resetCodexConfigSyncStallLatchForTests(): void {
  stalledHomes.clear()
}
