import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validate } from '../telemetry/validator'
import { recordAuthenticatedInventory, type DaemonAuditContext } from './daemon-audit-classifier'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }))
vi.mock('../telemetry/client', () => ({ track: trackMock }))

import {
  createDaemonAuditEligibilityTracker,
  trackDaemonAuditEligibility
} from './daemon-audit-eligibility-event'

const context: DaemonAuditContext = {
  protocolGeneration: 23,
  provider: 'local-daemon',
  endpoint: '/profile/daemon.sock',
  tokenPath: '/profile/daemon.token',
  endpointKind: 'unix-socket',
  profileScope: '/profile'
}

beforeEach(() => {
  trackMock.mockReset()
})

describe('daemon audit eligibility telemetry', () => {
  it('uses a dedicated validator-accepted event family', () => {
    trackDaemonAuditEligibility(recordAuthenticatedInventory(context, null))

    expect(trackMock).toHaveBeenCalledOnce()
    const [name, props] = trackMock.mock.calls[0]
    expect(name).toBe('daemon_audit_eligibility')
    expect(name).not.toBe('daemon_lifecycle')
    expect(props).toMatchObject({
      state: 'present',
      reason: 'authenticated_inventory',
      evidence_sources: ['authenticated_inventory'],
      protocol_generation: 23,
      exact_incarnation: 'unavailable',
      process_reason: null
    })
    expect(validate('daemon_audit_eligibility', props).ok).toBe(true)
  })

  it('cannot affect callers when telemetry throws', () => {
    trackMock.mockImplementation(() => {
      throw new Error('transport failed')
    })

    expect(() =>
      trackDaemonAuditEligibility(recordAuthenticatedInventory(context, null))
    ).not.toThrow()
  })

  it('collapses repeated identical observations into one heartbeat per window', () => {
    let nowMs = 1_700_000_000_000
    const trackEligibility = createDaemonAuditEligibilityTracker(() => nowMs)

    for (let index = 0; index < 60; index += 1) {
      nowMs += 1_000
      trackEligibility(recordAuthenticatedInventory(context, null))
    }

    expect(trackMock).toHaveBeenCalledOnce()

    nowMs += 5 * 60_000
    trackEligibility(recordAuthenticatedInventory(context, null))
    expect(trackMock).toHaveBeenCalledTimes(2)
  })

  it('emits immediately when the observation changes', () => {
    let nowMs = 1_700_000_000_000
    const trackEligibility = createDaemonAuditEligibilityTracker(() => nowMs)

    trackEligibility(recordAuthenticatedInventory(context, null))
    nowMs += 1_000
    trackEligibility(
      recordAuthenticatedInventory(context, {
        identity: { pid: 42, startedAtMs: nowMs, launchNonce: 'launch-a' }
      })
    )

    expect(trackMock).toHaveBeenCalledTimes(2)
    expect(trackMock.mock.calls[1][1]).toMatchObject({ exact_incarnation: 'endpoint-identity' })
  })
})

describe('daemon audit eligibility inventory volume', () => {
  let dir: string
  let socketPath: string
  let tokenPath: string
  let server: DaemonServer
  let adapter: DaemonPtyAdapter

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-audit-eligibility-'))
    socketPath = getDaemonSocketPath(dir)
    tokenPath = join(dir, 'daemon.token')
  })

  afterEach(async () => {
    adapter?.dispose()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not emit one eligibility event per successful inventory', async () => {
    server = new DaemonServer({
      socketPath,
      tokenPath,
      spawnSubprocess: () => {
        throw new Error('Test must not create a PTY')
      }
    })
    await server.start()
    adapter = new DaemonPtyAdapter({ socketPath, tokenPath })

    for (let index = 0; index < 40; index += 1) {
      await adapter.listProcesses()
    }

    expect(
      trackMock.mock.calls.filter(([name]) => name === 'daemon_audit_eligibility')
    ).toHaveLength(1)
  })
})
