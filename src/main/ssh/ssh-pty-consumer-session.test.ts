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
    resumed: false,
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
      state: {
        mode: 'negotiated',
        clientInstanceId: 'client-a',
        clientGeneration: 3,
        ownerGeneration: 7,
        ownerLease: 'lease-a'
      },
      resumed: false
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
      legacyOwnerGrant({ ownerGeneration: 8, ownerLease: 'lease-a', resumed: true })
    )
    const admission = await openSshPtyConsumerSession(mux, {
      clientInstanceId: 'client-a',
      expectedServerBuildId: 'build-a',
      resume: { ownerGeneration: 7, ownerLease: 'lease-a' }
    })

    expect(request.mock.calls[0][1]).toMatchObject({
      resume: { ownerGeneration: 7, ownerLease: 'lease-a' }
    })
    expect(admission.resumed).toBe(true)
  })

  it.each([undefined, 'yes', 1, null])(
    'rejects an owner grant that does not state whether the claim was resumed',
    async (resumed) => {
      const grant = legacyOwnerGrant()
      // Why not a legacy peer: the build id already matched, and client and relay ship together.
      if (resumed === undefined) {
        delete grant.resumed
      } else {
        grant.resumed = resumed
      }
      const { mux } = muxReturning(grant)

      await expect(
        openSshPtyConsumerSession(mux, {
          clientInstanceId: 'client-a',
          expectedServerBuildId: 'build-a'
        })
      ).rejects.toThrow('whether the claim was resumed')
    }
  )

  it('rejects a prior or mismatched relay build', async () => {
    const { mux } = muxReturning(legacyOwnerGrant({ serverBuildId: 'old-build' }))

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('session contract mismatch')
  })

  it('rejects an owner lease that cannot be resumed through the relay protocol', async () => {
    const { mux } = muxReturning(legacyOwnerGrant({ ownerLease: 'x'.repeat(513) }))

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('did not grant')
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

  it('negotiates exact operations inside the existing openClient round trip', async () => {
    const { mux, request } = muxReturning(
      legacyOwnerGrant({ capabilities: { exactOperations: { version: 1 } } })
    )

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        exactOperations: true
      })
    ).resolves.toMatchObject({
      state: { mode: 'negotiated', exactOperations: { version: 1 } }
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][1]).toMatchObject({
      capabilities: { exactOperations: { versions: [1] } }
    })
  })

  it('offers optional terminal topology without requiring an old gateway to grant it', async () => {
    const { mux, request } = muxReturning(legacyOwnerGrant())

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        terminalAuthorityTopology: true
      })
    ).resolves.not.toHaveProperty('state.terminalAuthorityTopology')
    expect(request.mock.calls[0][1]).toMatchObject({
      capabilities: { terminalAuthorityTopology: { versions: [1] } }
    })
  })

  it('offers optional authority proof without sending proof RPCs to an older relay', async () => {
    const { mux, request } = muxReturning(legacyOwnerGrant())

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        terminalAuthorityConsumerProof: true
      })
    ).resolves.not.toHaveProperty('state.terminalAuthorityConsumerProof')
    expect(request.mock.calls[0][1]).toMatchObject({
      capabilities: { terminalAuthorityConsumerProof: { versions: [1] } }
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('accepts only an offered authority proof grant with an authenticated host id', async () => {
    const proofGrant = legacyOwnerGrant({
      capabilities: {
        terminalAuthorityConsumerProof: {
          version: 1,
          authorityHostId: 'authority-host:ssh-test'
        }
      }
    })
    const { mux } = muxReturning(proofGrant)

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        terminalAuthorityConsumerProof: true
      })
    ).resolves.toMatchObject({
      state: {
        terminalAuthorityConsumerProof: {
          version: 1,
          authorityHostId: 'authority-host:ssh-test'
        }
      }
    })

    const { mux: unoffered } = muxReturning(proofGrant)
    await expect(
      openSshPtyConsumerSession(unoffered, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('unoffered terminal authority consumer proof')
  })

  it('requires the exact proof grant for an authenticated authority endpoint', async () => {
    const { mux: omitted } = muxReturning(legacyOwnerGrant())
    await expect(
      openSshPtyConsumerSession(omitted, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        terminalAuthorityConsumerProof: true,
        requiredTerminalAuthorityConsumerProofHostId: 'authority-host:ssh-test'
      })
    ).rejects.toThrow('mandatory terminal authority consumer proof')

    const { mux: wrongHost } = muxReturning(
      legacyOwnerGrant({
        capabilities: {
          terminalAuthorityConsumerProof: {
            version: 1,
            authorityHostId: 'authority-host:other'
          }
        }
      })
    )
    await expect(
      openSshPtyConsumerSession(wrongHost, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        terminalAuthorityConsumerProof: true,
        requiredTerminalAuthorityConsumerProofHostId: 'authority-host:ssh-test'
      })
    ).rejects.toThrow('another host')
  })

  it('accepts only an offered terminal topology grant', async () => {
    const topologyGrant = legacyOwnerGrant({
      capabilities: { terminalAuthorityTopology: { version: 1 } }
    })
    const { mux } = muxReturning(topologyGrant)

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        terminalAuthorityTopology: true
      })
    ).resolves.toMatchObject({
      state: { terminalAuthorityTopology: { version: 1 } }
    })

    const { mux: unoffered } = muxReturning(topologyGrant)
    await expect(
      openSshPtyConsumerSession(unoffered, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('invalid or unoffered terminal topology')
  })

  it('does not silently downgrade when a current relay omits the requested exact grant', async () => {
    const { mux } = muxReturning(legacyOwnerGrant())

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        exactOperations: true
      })
    ).rejects.toThrow('did not grant the offered PTY exact-operation capability')
  })

  it('rejects an invalid or unoffered exact-operation grant', async () => {
    const { mux } = muxReturning(
      legacyOwnerGrant({ capabilities: { exactOperations: { version: 2 } } })
    )

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        exactOperations: true
      })
    ).rejects.toThrow('did not grant the offered')

    const { mux: unofferedMux } = muxReturning(
      legacyOwnerGrant({ capabilities: { exactOperations: { version: 1 } } })
    )
    await expect(
      openSshPtyConsumerSession(unofferedMux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a'
      })
    ).rejects.toThrow('invalid or unoffered')
  })

  it('uses explicit token-free fallback only for same-build method-not-found', async () => {
    const error = Object.assign(new Error('Method not found: pty.openClient'), { code: -32601 })
    const request = vi.fn().mockRejectedValue(error)
    const mux = { request } as unknown as SshChannelMultiplexer

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        allowSameBuildLegacyFallback: true,
        outputFlowControl: { requestedWindowSu: 64 },
        exactOperations: true
      })
    ).resolves.toEqual({
      state: {
        mode: 'legacy-fallback',
        clientInstanceId: 'client-a',
        serverBuildId: 'build-a'
      },
      resumed: false
    })

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        allowSameBuildLegacyFallback: true,
        terminalAuthorityConsumerProof: true,
        requiredTerminalAuthorityConsumerProofHostId: 'authority-host:ssh-test'
      })
    ).rejects.toBe(error)
  })

  it.each([
    Object.assign(new Error('timeout'), { code: 'TIMEOUT' }),
    Object.assign(new Error('auth failed'), { code: -32000 }),
    Object.assign(new Error('method missing'), { code: -32601 })
  ])('does not downgrade an unproved or non-method-not-found error', async (error) => {
    const request = vi.fn().mockRejectedValue(error)
    const mux = { request } as unknown as SshChannelMultiplexer

    await expect(
      openSshPtyConsumerSession(mux, {
        clientInstanceId: 'client-a',
        expectedServerBuildId: 'build-a',
        allowSameBuildLegacyFallback: error.code !== -32601
      })
    ).rejects.toBe(error)
  })
})
