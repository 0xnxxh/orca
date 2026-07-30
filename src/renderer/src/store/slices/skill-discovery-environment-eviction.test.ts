/**
 * Staleness + memory-leak regression (#11429): runtime-scoped skill discovery
 * cache entries must be evicted when their runtime environment leaves the
 * saved list.
 *
 * Remote scans cache under `runtime:<environmentId>` (#6887) in the bounded
 * LRU (#7670), but nothing evicted them on environment removal. Ephemeral VMs
 * mint a fresh environment id per start, so every start left a permanently
 * retained entry until LRU pressure, and re-pairing an id served the removed
 * peer's skill list. `setRuntimeEnvironments` now evicts retired ids —
 * removed and same-id re-paired alike.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { SkillDiscoveryResult } from '../../../../shared/skills'
import {
  getRuntimeScopedSkillDiscoveryKey,
  resetSkillDiscoveryCacheForTests
} from '@/hooks/installed-agent-skill-discovery'
import {
  hasInstalledAgentSkillDiscoveryCacheEntryForTests,
  writeInstalledAgentSkillDiscoveryCache
} from '@/hooks/installed-agent-skill-discovery-cache'
import { createRuntimeStatusSlice, type RuntimeStatusSlice } from './runtime-status'

function createSliceStore() {
  return create<RuntimeStatusSlice>()((...a) => ({
    ...createRuntimeStatusSlice(...(a as unknown as Parameters<typeof createRuntimeStatusSlice>))
  }))
}

function env(id: string, pairingRevision = 1): PublicKnownRuntimeEnvironment {
  return { id, createdAt: 1, pairingRevision } as unknown as PublicKnownRuntimeEnvironment
}

function discovery(scannedAt: number): SkillDiscoveryResult {
  return { skills: [], sources: [], scannedAt }
}

function runtimeKey(environmentId: string): string {
  return getRuntimeScopedSkillDiscoveryKey({ kind: 'environment', environmentId }, undefined)
}

afterEach(() => {
  resetSkillDiscoveryCacheForTests()
})

describe('skill discovery cache evicted on environment removal (#11429)', () => {
  it("evicts a removed environment's runtime-scoped entry and keeps survivors", () => {
    const store = createSliceStore()
    store.getState().setRuntimeEnvironments([env('env-keep'), env('env-drop')])
    writeInstalledAgentSkillDiscoveryCache(runtimeKey('env-keep'), discovery(1))
    writeInstalledAgentSkillDiscoveryCache(runtimeKey('env-drop'), discovery(2))
    writeInstalledAgentSkillDiscoveryCache('host', discovery(3))

    store.getState().setRuntimeEnvironments([env('env-keep')])

    expect(hasInstalledAgentSkillDiscoveryCacheEntryForTests(runtimeKey('env-drop'))).toBe(false)
    // Surviving remote and local entries stay warm — eviction is keyed, not a flush.
    expect(hasInstalledAgentSkillDiscoveryCacheEntryForTests(runtimeKey('env-keep'))).toBe(true)
    expect(hasInstalledAgentSkillDiscoveryCacheEntryForTests('host')).toBe(true)
  })

  it("evicts on same-id re-pair so the retired peer's skill list is not served", () => {
    const store = createSliceStore()
    store.getState().setRuntimeEnvironments([env('env-a', 1)])
    writeInstalledAgentSkillDiscoveryCache(runtimeKey('env-a'), discovery(1))

    store.getState().setRuntimeEnvironments([env('env-a', 2)])

    expect(hasInstalledAgentSkillDiscoveryCacheEntryForTests(runtimeKey('env-a'))).toBe(false)
  })
})
