import { describe, expect, it, vi } from 'vitest'

const codexMocks = vi.hoisted(() => ({
  codexHookService: { install: vi.fn(), refreshRuntimeUserHooks: vi.fn() },
  createCodexSessionMigrationScheduler: vi.fn(),
  ensureRealHomeCodexHookState: vi.fn(),
  getOrcaManagedCodexHomePath: vi.fn(),
  getSystemCodexHomePath: vi.fn(),
  isRealHomeCodexHookLaneUsable: vi.fn(),
  markCodexProjectTrusted: vi.fn(),
  normalizeCodexRuntimeSelection: vi.fn(),
  prepareCodexSessionResume: vi.fn(),
  prepareLegacySharedCodexSessionResume: vi.fn(),
  resolveHostCodexSessionSourceHome: vi.fn(),
  setCodexTrustGrantTelemetry: vi.fn(),
  setSystemCodexHomeHookSweepSuppressed: vi.fn(),
  startCodexSessionBackfillInBackground: vi.fn(),
  startCodexSessionIndexHealInBackground: vi.fn()
}))

vi.mock('../agent-trust-presets', () => ({
  markCodexProjectTrusted: codexMocks.markCodexProjectTrusted
}))
vi.mock('../codex-accounts/runtime-selection', () => ({
  normalizeCodexRuntimeSelection: codexMocks.normalizeCodexRuntimeSelection
}))
vi.mock('../codex/hook-service', () => ({
  codexHookService: codexMocks.codexHookService,
  setSystemCodexHomeHookSweepSuppressed: codexMocks.setSystemCodexHomeHookSweepSuppressed
}))
vi.mock('../codex/codex-real-home-hook-install', () => ({
  ensureRealHomeCodexHookState: codexMocks.ensureRealHomeCodexHookState,
  isRealHomeCodexHookLaneUsable: codexMocks.isRealHomeCodexHookLaneUsable
}))
vi.mock('../codex/codex-home-paths', () => ({
  getOrcaManagedCodexHomePath: codexMocks.getOrcaManagedCodexHomePath,
  getSystemCodexHomePath: codexMocks.getSystemCodexHomePath
}))
vi.mock('../codex/codex-legacy-session-resume', () => ({
  prepareLegacySharedCodexSessionResume: codexMocks.prepareLegacySharedCodexSessionResume
}))
vi.mock('../codex/codex-session-backfill', () => ({
  startCodexSessionBackfillInBackground: codexMocks.startCodexSessionBackfillInBackground
}))
vi.mock('../codex/codex-session-index-heal', () => ({
  startCodexSessionIndexHealInBackground: codexMocks.startCodexSessionIndexHealInBackground
}))
vi.mock('../codex/codex-session-migration-scheduler', () => ({
  createCodexSessionMigrationScheduler: codexMocks.createCodexSessionMigrationScheduler
}))
vi.mock('../codex/codex-session-resume-preparation', () => ({
  prepareCodexSessionResume: codexMocks.prepareCodexSessionResume
}))
vi.mock('../codex/codex-session-source-home', () => ({
  resolveHostCodexSessionSourceHome: codexMocks.resolveHostCodexSessionSourceHome
}))
vi.mock('../codex/codex-trust-grant-telemetry', () => ({
  setCodexTrustGrantTelemetry: codexMocks.setCodexTrustGrantTelemetry
}))

import { createCodexLaunchSessionStartupCapability } from './codex-launch-session-startup-capability'

describe('Codex launch/session startup capability', () => {
  it('returns every original singleton and function identity', () => {
    expect(createCodexLaunchSessionStartupCapability()).toEqual(codexMocks)
  })
})
