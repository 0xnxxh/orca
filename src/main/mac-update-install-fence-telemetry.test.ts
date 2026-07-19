import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  track: vi.fn(),
  lifecycle: vi.fn()
}))

vi.mock('./mac-update-install-fence-diagnostics', () => ({
  consumeMacUpdateFenceDiagnostics: mocks.consume
}))
vi.mock('./telemetry/client', () => ({ track: mocks.track }))
vi.mock('./updater-lifecycle-diagnostics', () => ({
  recordUpdaterLifecycle: mocks.lifecycle
}))

import { ingestMacUpdateFenceDiagnostics } from './mac-update-install-fence-telemetry'

const ATTEMPT_ID = '48f675fc-3017-4d19-9e41-fd4715a17f43'

beforeEach(() => {
  mocks.consume.mockReset()
  mocks.track.mockReset()
  mocks.lifecycle.mockReset()
})

describe('mac update install fence telemetry', () => {
  it('forwards bounded monitor diagnostics through normal startup telemetry', () => {
    mocks.consume.mockReturnValue([
      {
        event: 'mac_update_fence_shipit_seen',
        at: 1_800_000_000_000,
        attemptId: ATTEMPT_ID,
        sourceVersion: '1.0.0',
        targetVersion: '1.0.1'
      },
      {
        event: 'mac_update_fence_recovered',
        at: 1_800_000_001_000,
        attemptId: ATTEMPT_ID,
        sourceVersion: '1.0.0',
        targetVersion: '1.0.1',
        reason: 'target_installed'
      }
    ])

    ingestMacUpdateFenceDiagnostics()

    expect(mocks.track).toHaveBeenCalledWith('mac_update_fence_shipit_seen', {
      attempt_id: ATTEMPT_ID,
      source_version: '1.0.0',
      target_version: '1.0.1'
    })
    expect(mocks.track).toHaveBeenCalledWith('mac_update_fence_recovered', {
      attempt_id: ATTEMPT_ID,
      source_version: '1.0.0',
      target_version: '1.0.1',
      reason: 'target_installed'
    })
    expect(mocks.lifecycle).toHaveBeenCalledTimes(2)
  })

  it('keeps malformed persisted fields off telemetry', () => {
    mocks.consume.mockReturnValue([
      { event: 'mac_update_fence_recovered', at: 1, reason: 'not-a-bounded-reason' }
    ])

    ingestMacUpdateFenceDiagnostics()

    expect(mocks.track).not.toHaveBeenCalled()
    expect(mocks.lifecycle).toHaveBeenCalledOnce()
  })

  it('reports a terminal install failure so startup can notify the user', () => {
    mocks.consume.mockReturnValue([
      {
        event: 'mac_update_fence_recovered',
        at: 1_800_000_000_000,
        attemptId: ATTEMPT_ID,
        sourceVersion: '1.0.0',
        targetVersion: '1.0.1',
        reason: 'shipit_not_seen'
      }
    ])

    expect(ingestMacUpdateFenceDiagnostics()).toEqual({
      failedInstall: { targetVersion: '1.0.1' }
    })
  })

  it('suppresses the failure notice when the target was observed installed', () => {
    mocks.consume.mockReturnValue([
      {
        event: 'mac_update_fence_post_commit_failure',
        at: 1_800_000_000_000,
        targetVersion: '1.0.1',
        errorType: 'Error'
      },
      {
        event: 'mac_update_fence_target_observed',
        at: 1_800_000_001_000,
        attemptId: ATTEMPT_ID,
        sourceVersion: '1.0.0',
        targetVersion: '1.0.1'
      }
    ])

    expect(ingestMacUpdateFenceDiagnostics()).toEqual({ failedInstall: null })
  })

  it('does not treat expected recoveries as install failures', () => {
    mocks.consume.mockReturnValue([
      {
        event: 'mac_update_fence_recovered',
        at: 1_800_000_000_000,
        reason: 'stale_lease'
      }
    ])

    expect(ingestMacUpdateFenceDiagnostics()).toEqual({ failedInstall: null })
  })
})
