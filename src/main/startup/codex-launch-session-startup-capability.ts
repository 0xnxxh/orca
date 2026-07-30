import { markCodexProjectTrusted } from '../agent-trust-presets'
import { normalizeCodexRuntimeSelection } from '../codex-accounts/runtime-selection'
import { codexHookService, setSystemCodexHomeHookSweepSuppressed } from '../codex/hook-service'
import {
  ensureRealHomeCodexHookState,
  isRealHomeCodexHookLaneUsable
} from '../codex/codex-real-home-hook-install'
import { getOrcaManagedCodexHomePath, getSystemCodexHomePath } from '../codex/codex-home-paths'
import { prepareLegacySharedCodexSessionResume } from '../codex/codex-legacy-session-resume'
import { startCodexSessionBackfillInBackground } from '../codex/codex-session-backfill'
import { startCodexSessionIndexHealInBackground } from '../codex/codex-session-index-heal'
import { createCodexSessionMigrationScheduler } from '../codex/codex-session-migration-scheduler'
import { prepareCodexSessionResume } from '../codex/codex-session-resume-preparation'
import { resolveHostCodexSessionSourceHome } from '../codex/codex-session-source-home'
import { setCodexTrustGrantTelemetry } from '../codex/codex-trust-grant-telemetry'

export type CodexLaunchSessionStartupCapability = {
  codexHookService: typeof codexHookService
  createCodexSessionMigrationScheduler: typeof createCodexSessionMigrationScheduler
  ensureRealHomeCodexHookState: typeof ensureRealHomeCodexHookState
  getOrcaManagedCodexHomePath: typeof getOrcaManagedCodexHomePath
  getSystemCodexHomePath: typeof getSystemCodexHomePath
  isRealHomeCodexHookLaneUsable: typeof isRealHomeCodexHookLaneUsable
  markCodexProjectTrusted: typeof markCodexProjectTrusted
  normalizeCodexRuntimeSelection: typeof normalizeCodexRuntimeSelection
  prepareCodexSessionResume: typeof prepareCodexSessionResume
  prepareLegacySharedCodexSessionResume: typeof prepareLegacySharedCodexSessionResume
  resolveHostCodexSessionSourceHome: typeof resolveHostCodexSessionSourceHome
  setCodexTrustGrantTelemetry: typeof setCodexTrustGrantTelemetry
  setSystemCodexHomeHookSweepSuppressed: typeof setSystemCodexHomeHookSweepSuppressed
  startCodexSessionBackfillInBackground: typeof startCodexSessionBackfillInBackground
  startCodexSessionIndexHealInBackground: typeof startCodexSessionIndexHealInBackground
}

export function createCodexLaunchSessionStartupCapability(): CodexLaunchSessionStartupCapability {
  return {
    codexHookService,
    createCodexSessionMigrationScheduler,
    ensureRealHomeCodexHookState,
    getOrcaManagedCodexHomePath,
    getSystemCodexHomePath,
    isRealHomeCodexHookLaneUsable,
    markCodexProjectTrusted,
    normalizeCodexRuntimeSelection,
    prepareCodexSessionResume,
    prepareLegacySharedCodexSessionResume,
    resolveHostCodexSessionSourceHome,
    setCodexTrustGrantTelemetry,
    setSystemCodexHomeHookSweepSuppressed,
    startCodexSessionBackfillInBackground,
    startCodexSessionIndexHealInBackground
  }
}
