import {
  attachClaudeLivePtyPersistence,
  onLiveClaudePtysDrained,
  seedLiveClaudePtysFromPersistence
} from '../claude-accounts/live-pty-gate'
import { normalizeClaudeRuntimeSelection } from '../claude-accounts/runtime-selection'
import { readMiniMaxSessionCookie } from '../minimax/minimax-cookie-store'
import { createAccountRuntimeTargetSettingsSync } from '../rate-limits/account-runtime-target-sync'
import { getInitialClaudeRateLimitTarget } from '../rate-limits/claude-rate-limit-target'
import { getInitialCodexRateLimitTarget } from '../rate-limits/codex-rate-limit-target'

export type AccountRuntimeCoordinationStartupCapability = {
  attachClaudeLivePtyPersistence: typeof attachClaudeLivePtyPersistence
  createAccountRuntimeTargetSettingsSync: typeof createAccountRuntimeTargetSettingsSync
  getInitialClaudeRateLimitTarget: typeof getInitialClaudeRateLimitTarget
  getInitialCodexRateLimitTarget: typeof getInitialCodexRateLimitTarget
  normalizeClaudeRuntimeSelection: typeof normalizeClaudeRuntimeSelection
  onLiveClaudePtysDrained: typeof onLiveClaudePtysDrained
  readMiniMaxSessionCookie: typeof readMiniMaxSessionCookie
  seedLiveClaudePtysFromPersistence: typeof seedLiveClaudePtysFromPersistence
}

export function createAccountRuntimeCoordinationStartupCapability(): AccountRuntimeCoordinationStartupCapability {
  return {
    attachClaudeLivePtyPersistence,
    createAccountRuntimeTargetSettingsSync,
    getInitialClaudeRateLimitTarget,
    getInitialCodexRateLimitTarget,
    normalizeClaudeRuntimeSelection,
    onLiveClaudePtysDrained,
    readMiniMaxSessionCookie,
    seedLiveClaudePtysFromPersistence
  }
}
