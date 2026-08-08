import { describe, expect, it, vi } from 'vitest'
import type { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import { TerminalAuthorityControlClient } from './terminal-authority-control-client'

function harness() {
  const mux = {
    request: vi.fn(),
    dispose: vi.fn()
  }
  return {
    mux,
    client: new TerminalAuthorityControlClient(mux as unknown as SshChannelMultiplexer)
  }
}

describe('terminal authority control client', () => {
  it('acknowledges grace only after the authority applies the exact value', async () => {
    const { client, mux } = harness()
    mux.request.mockResolvedValueOnce({ graceTimeMs: 600_000 })

    await expect(client.configureGraceTime(600)).resolves.toEqual({ graceTimeMs: 600_000 })
    expect(mux.request).toHaveBeenCalledWith('terminalAuthority.configureGraceTime', {
      graceTimeSeconds: 600
    })
  })

  it('holds and explicitly releases one connection-scoped removal lease', async () => {
    const { client, mux } = harness()
    mux.request
      .mockResolvedValueOnce({ leaseToken: 'control-1' })
      .mockResolvedValueOnce({ leaseToken: 'control-1' })

    const release = await client.acquireWorktreeRemoval('/repo')
    await release()
    await release()

    expect(mux.request).toHaveBeenNthCalledWith(1, 'terminalAuthority.acquireWorktreeRemoval', {
      leaseToken: 'control-1',
      rootPath: '/repo'
    })
    expect(mux.request).toHaveBeenNthCalledWith(2, 'terminalAuthority.releaseWorktreeRemoval', {
      leaseToken: 'control-1',
      rootPath: '/repo'
    })
    expect(mux.request).toHaveBeenCalledTimes(2)
  })

  it('fails closed on missing methods and false acknowledgements', async () => {
    const missing = harness()
    missing.mux.request.mockRejectedValueOnce(new Error('Method not found'))
    await expect(missing.client.configureGraceTime(60)).rejects.toThrow('control request failed')
    expect(missing.mux.dispose).toHaveBeenCalledWith('connection_lost')

    const falseAck = harness()
    falseAck.mux.request.mockResolvedValueOnce({ graceTimeMs: 59_000 })
    await expect(falseAck.client.configureGraceTime(60)).rejects.toThrow('not_applied')
    expect(falseAck.mux.dispose).toHaveBeenCalledWith('connection_lost')
  })
})
