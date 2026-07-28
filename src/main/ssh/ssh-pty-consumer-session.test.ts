import { describe, expect, it, vi } from 'vitest'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { openSshPtyConsumerSession } from './ssh-pty-consumer-session'

function muxReturning(result: unknown): {
  mux: SshChannelMultiplexer
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn().mockResolvedValue(result)
  return { mux: { request } as unknown as SshChannelMultiplexer, request }
}

function legacyOwnerGrant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    serverBuildId: 'build-a',
    clientGeneration: 3,
    role: 'session-owner',
    ownerGeneration: 7,
    ownerLease: 'lease-a',
    ...overrides
  }
}

describe('openSshPtyConsumerSession', () => {
  it('makes openClient the one request needed for token-free legacy readiness', async () => {
    const { mux, request } = muxReturning(legacyOwnerGrant())

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).resolves.toEqual({
      clientInstanceId: 'client-a',
      clientGeneration: 3,
      ownerGeneration: 7,
      ownerLease: 'lease-a'
    })
    expect(request).toHaveBeenCalledWith(
      'pty.openClient',
      {
        protocolVersion: 1,
        clientInstanceId: 'client-a',
        requestedRole: 'session-owner'
      },
      { timeoutMs: 10_000 }
    )
  })

  it('carries recovery generation and lease on reconnect', async () => {
    const { mux, request } = muxReturning(
      legacyOwnerGrant({ ownerGeneration: 8, ownerLease: 'lease-b' })
    )
    await openSshPtyConsumerSession(mux, {
      clientInstanceId: 'client-a',
      expectedServerBuildId: 'build-a',
      resume: { ownerGeneration: 7, ownerLease: 'lease-a' }
    })

    expect(request.mock.calls[0][1]).toMatchObject({
      resume: { ownerGeneration: 7, ownerLease: 'lease-a' }
    })
  })

  it('rejects a prior or mismatched relay build', async () => {
    const { mux } = muxReturning(legacyOwnerGrant({ serverBuildId: 'old-build' }))

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('session contract mismatch')
  })

  it('does not silently downgrade when V1 was offered', async () => {
    const { mux } = muxReturning(legacyOwnerGrant())

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        outputFlowControl: { requestedWindowSu: 64 }
      })
    ).rejects.toThrow('did not grant')
  })

  it('rejects an unoffered V1 capability in a legacy session', async () => {
    const { mux } = muxReturning(
      legacyOwnerGrant({
        capabilities: { outputFlowControl: { version: 1, windowSu: 64 } }
      })
    )

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('unoffered')
  })
})
