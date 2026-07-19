import { describe, expect, it } from 'vitest'
import {
  MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS,
  decideMacUpdateFenceStartup,
  macPathsEqual,
  parseMacUpdateInstallFence,
  type MacUpdateInstallFence
} from './mac-update-install-fence'

const NOW = 1_800_000_000_000
const TARGET_PATH = '/Applications/Orca.app'

function createFence(overrides: Partial<MacUpdateInstallFence> = {}): MacUpdateInstallFence {
  return {
    schemaVersion: 1,
    attemptId: '5d44ba31-c544-4b36-a107-83feee727d2a',
    bundleIdentifier: 'com.stablyai.orca',
    sourceVersion: '1.4.144-rc.1',
    targetVersion: '1.4.144-rc.2',
    targetBundlePath: TARGET_PATH,
    shipItStatePath: '/Users/test/Library/Caches/com.stablyai.orca.ShipIt/ShipItState.plist',
    sourcePid: 100,
    monitorPid: 101,
    phase: 'awaiting-shipit',
    createdAt: NOW - 10_000,
    heartbeatAt: NOW - 1_000,
    lastTransitionAt: NOW - 5_000,
    absoluteExpiresAt: NOW - 10_000 + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS,
    ...overrides
  }
}

function decide(overrides: Partial<Parameters<typeof decideMacUpdateFenceStartup>[0]> = {}) {
  return decideMacUpdateFenceStartup({
    fence: createFence(),
    now: NOW,
    currentVersion: '1.4.144-rc.1',
    currentBundlePath: TARGET_PATH,
    ...overrides
  })
}

describe('mac update install fence contract', () => {
  it('blocks a source-version launch while the lease is fresh', () => {
    expect(decide()).toEqual({ kind: 'block', action: 'none', reason: 'active_install' })
  })

  it('allows the exact target and claims the matching attempt', () => {
    expect(decide({ currentVersion: '1.4.144-rc.2' })).toEqual({
      kind: 'start',
      action: 'remove',
      reason: 'target_installed'
    })
  })

  it('allows only a version newer than both source and target to supersede', () => {
    expect(decide({ currentVersion: '1.4.145' }).reason).toBe('superseded')
    expect(
      decide({
        fence: createFence({ sourceVersion: '2.0.0', targetVersion: '1.9.0' }),
        currentVersion: '2.0.0'
      }).kind
    ).toBe('block')
  })

  it('fails open when the current version cannot be compared', () => {
    expect(decide({ currentVersion: 'unknown' })).toEqual({
      kind: 'start',
      action: 'remove',
      reason: 'incomparable_version'
    })
  })

  it('keeps stale leases active when recovery or a matching process proves ownership', () => {
    const fence = createFence({ heartbeatAt: NOW - 20_000 })
    expect(decide({ fence, leaseAdvancedDuringGrace: true }).reason).toBe('lease_recovered')
    expect(decide({ fence, monitorIdentityAlive: true }).reason).toBe('monitor_alive')
    expect(decide({ fence, matchingShipItAlive: true }).reason).toBe('shipit_alive')
    expect(decide({ fence })).toEqual({
      kind: 'start',
      action: 'remove',
      reason: 'stale_lease'
    })
  })

  it('uses matching ShipIt, not monitor liveness, at the absolute deadline', () => {
    const fence = createFence({ absoluteExpiresAt: NOW - 1 })
    expect(decide({ fence, monitorIdentityAlive: true }).reason).toBe('absolute_timeout')
    expect(decide({ fence, matchingShipItAlive: true })).toEqual({
      kind: 'block',
      action: 'none',
      reason: 'shipit_alive'
    })
  })

  it('normalizes the data-volume firmlink and path case', () => {
    expect(
      macPathsEqual('/System/Volumes/Data/Applications/ORCA.app/', '/Applications/Orca.app')
    ).toBe(true)
  })

  it('ignores a fence for a different app path', () => {
    expect(decide({ currentBundlePath: '/Applications/Orca Beta.app' })).toEqual({
      kind: 'start',
      action: 'none',
      reason: 'different_target'
    })
  })

  it('strictly parses valid state while allowing additive diagnostics', () => {
    const parsed = parseMacUpdateInstallFence(
      JSON.stringify({ ...createFence(), diagnosticOutcome: 'pending' }),
      NOW
    )
    expect(parsed).toMatchObject({ ok: true, fence: { phase: 'awaiting-shipit' } })
  })

  it.each([
    ['malformed JSON', '{'],
    ['unknown schema', JSON.stringify({ ...createFence(), schemaVersion: 2 })],
    [
      'impossible lifetime',
      JSON.stringify(
        createFence({ absoluteExpiresAt: NOW + 2 * MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS })
      )
    ],
    ['relative target', JSON.stringify(createFence({ targetBundlePath: 'Orca.app' }))]
  ])('fails open while classifying %s', (_name, contents) => {
    expect(parseMacUpdateInstallFence(contents, NOW).ok).toBe(false)
  })

  it('survives a wall-clock step back by clamping future timestamps', () => {
    // Why: after a clock step back mid-install, every stored timestamp sits in
    // the future and fresh heartbeats fall below createdAt. The fence must stay
    // valid (deleting it would let a launch abort the running install) while
    // the clamped expiry still bounds blocking to the fence lifetime.
    const stepBackMs = 2 * 60 * 60_000
    const fence = createFence({
      createdAt: NOW + stepBackMs,
      heartbeatAt: NOW - 500,
      lastTransitionAt: NOW + stepBackMs,
      absoluteExpiresAt: NOW + stepBackMs + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS
    })
    const parsed = parseMacUpdateInstallFence(JSON.stringify(fence), NOW)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.fence.heartbeatAt).toBe(NOW - 500)
      expect(parsed.fence.absoluteExpiresAt).toBeLessThanOrEqual(
        NOW + 5_000 + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS
      )
      expect(
        decideMacUpdateFenceStartup({
          fence: parsed.fence,
          now: NOW,
          currentVersion: '1.4.144-rc.1',
          currentBundlePath: TARGET_PATH
        }).kind
      ).toBe('block')
    }
  })

  it('does not trust a clock-clamped future heartbeat without process evidence', () => {
    // Why: with a dead monitor, a clamped future heartbeat would otherwise
    // read fresh on every evaluation and black out launches for the full size
    // of the backward step. Liveness must come from the process probes.
    const stepBackMs = 10 * 60_000
    const fence = createFence({
      createdAt: NOW + stepBackMs - 10_000,
      heartbeatAt: NOW + stepBackMs,
      lastTransitionAt: NOW + stepBackMs,
      absoluteExpiresAt: NOW + stepBackMs - 10_000 + MAC_UPDATE_FENCE_ABSOLUTE_LIFETIME_MS
    })
    const parsed = parseMacUpdateInstallFence(JSON.stringify(fence), NOW)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.fence.heartbeatAt).toBeGreaterThan(NOW)
    expect(
      decideMacUpdateFenceStartup({
        fence: parsed.fence,
        now: NOW,
        currentVersion: '1.4.144-rc.1',
        currentBundlePath: TARGET_PATH,
        monitorIdentityAlive: false,
        matchingShipItAlive: false
      })
    ).toEqual({ kind: 'start', action: 'remove', reason: 'stale_lease' })
    expect(
      decideMacUpdateFenceStartup({
        fence: parsed.fence,
        now: NOW,
        currentVersion: '1.4.144-rc.1',
        currentBundlePath: TARGET_PATH,
        monitorIdentityAlive: true,
        matchingShipItAlive: false
      }).reason
    ).toBe('monitor_alive')
  })

  it('rejects oversized state before JSON parsing', () => {
    expect(parseMacUpdateInstallFence(`{"padding":"${'x'.repeat(40_000)}"}`, NOW)).toEqual({
      ok: false,
      reason: 'malformed'
    })
  })
})
