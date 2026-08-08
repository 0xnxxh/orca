import { describe, expect, it, vi } from 'vitest'
import {
  readCurrentTerminalAuthorityOwnerProcessIdentity,
  terminalAuthorityOwnerProcessObservationProvesGone
} from './terminal-session-authority-owner-process'

describe('terminal authority owner process identity', () => {
  it('does not change when the wall clock steps', async () => {
    const before = await readCurrentTerminalAuthorityOwnerProcessIdentity()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    try {
      const after = await readCurrentTerminalAuthorityOwnerProcessIdentity()
      expect(after).toEqual(before)
    } finally {
      clock.mockRestore()
    }
  })

  it('uses exact native process creation identity for PID reuse', () => {
    const identity = {
      pid: 42,
      platform: 'darwin' as const,
      startedAtMs: 1_000,
      executionScope: 'host-a'
    }
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'present',
        platform: 'darwin',
        startedAtMs: 1_000,
        executionScope: 'host-a'
      })
    ).toBe(false)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'present',
        platform: 'darwin',
        startedAtMs: 1_001,
        executionScope: 'host-a'
      })
    ).toBe(true)
  })

  it('requires exact Linux boot and start-tick evidence', () => {
    const identity = {
      pid: 42,
      platform: 'linux' as const,
      bootId: 'boot-a',
      linuxStartTicks: '100',
      linuxPidNamespace: 'pid:[101]',
      executionScope: 'host-a'
    }
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'present',
        platform: 'linux',
        bootId: 'boot-a',
        linuxStartTicks: '100',
        linuxPidNamespace: 'pid:[101]',
        executionScope: 'host-a'
      })
    ).toBe(false)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'present',
        platform: 'linux',
        bootId: 'boot-a',
        linuxStartTicks: '101',
        linuxPidNamespace: 'pid:[101]',
        executionScope: 'host-a'
      })
    ).toBe(true)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'present',
        platform: 'linux',
        bootId: 'boot-b',
        linuxStartTicks: '101',
        linuxPidNamespace: 'pid:[101]',
        executionScope: 'host-a'
      })
    ).toBe(true)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'missing',
        platform: 'linux',
        bootId: 'boot-a',
        linuxPidNamespace: 'pid:[101]',
        executionScope: 'host-a'
      })
    ).toBe(true)
  })

  it('treats missing as death and every inspection gap as unknown', () => {
    const identity = {
      pid: 42,
      platform: 'win32' as const,
      startedAtMs: 1_000,
      executionScope: 'host-a'
    }
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'missing',
        platform: 'win32',
        executionScope: 'host-a'
      })
    ).toBe(true)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'unknown',
        platform: 'win32',
        executionScope: 'host-a'
      })
    ).toBe(false)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'present',
        platform: 'win32',
        executionScope: 'host-a'
      })
    ).toBe(false)
  })

  it('never treats another execution scope or Linux PID namespace as death proof', () => {
    const linux = {
      pid: 1,
      platform: 'linux' as const,
      bootId: 'shared-boot',
      linuxStartTicks: '1',
      linuxPidNamespace: 'pid:[101]',
      executionScope: 'host-a'
    }
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(linux, {
        status: 'missing',
        platform: 'linux',
        bootId: 'shared-boot',
        linuxPidNamespace: 'pid:[101]',
        executionScope: 'host-b'
      })
    ).toBe(false)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(linux, {
        status: 'present',
        platform: 'linux',
        bootId: 'shared-boot',
        linuxStartTicks: '2',
        linuxPidNamespace: 'pid:[202]',
        executionScope: 'host-a'
      })
    ).toBe(false)
  })

  it('treats missing or unreadable execution scope as unknown', () => {
    const identity = {
      pid: 42,
      platform: 'darwin' as const,
      startedAtMs: 1_000,
      executionScope: 'host-a'
    }
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(identity, {
        status: 'missing',
        platform: 'darwin'
      })
    ).toBe(false)
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(
        { pid: 42, platform: 'darwin', startedAtMs: 1_000 },
        {
          status: 'missing',
          platform: 'darwin',
          executionScope: 'host-a'
        }
      )
    ).toBe(false)
  })

  it('never proves death from an older Linux identity without a PID namespace', () => {
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(
        {
          pid: 42,
          platform: 'linux',
          bootId: 'boot-a',
          linuxStartTicks: '100',
          executionScope: 'host-a'
        },
        {
          status: 'missing',
          platform: 'linux',
          linuxPidNamespace: 'pid:[101]',
          executionScope: 'host-a'
        }
      )
    ).toBe(false)
  })

  it('never upgrades a legacy wall-clock timestamp into death proof', () => {
    expect(
      terminalAuthorityOwnerProcessObservationProvesGone(
        {
          pid: 42,
          platform: 'legacy',
          startedAtMs: 1_000,
          executionScope: 'host-a'
        },
        {
          status: 'present',
          platform: 'darwin',
          startedAtMs: 5_000,
          executionScope: 'host-a'
        }
      )
    ).toBe(false)
  })
})
