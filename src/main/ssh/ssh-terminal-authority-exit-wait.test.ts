import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import {
  prepareSshTerminalAuthorityExitWait,
  publishSshTerminalPhysicalExit
} from './ssh-terminal-authority-exit-wait'

const authorityAccess: TerminalSessionAuthorityPtyAccess = {
  namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
  pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
  binding: {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
}

const target = {
  targetId: 'ssh-1',
  relayPtyId: 'pty-1',
  appPtyId: 'ssh:ssh-1@@pty-1',
  authorityAccess
} as const

function storeMock(): Pick<Store, 'requestSshRemotePtyClose' | 'clearSshRemotePtyCloseRequest'> {
  return {
    requestSshRemotePtyClose: vi.fn(() => 'recorded' as const),
    clearSshRemotePtyCloseRequest: vi.fn(() => true)
  }
}

describe('SSH terminal authority exit wait', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers the exact physical-exit observer before persisting close intent', async () => {
    const store = storeMock()
    vi.mocked(store.requestSshRemotePtyClose).mockImplementation(() => {
      publishExactExit()
      return 'recorded'
    })

    const wait = prepareSshTerminalAuthorityExitWait(store as Store, target)

    await expect(wait.completion).resolves.toBe(true)
    expect(store.requestSshRemotePtyClose).toHaveBeenCalledWith('ssh-1', 'pty-1', {
      incarnationId: 'incarnation-1',
      terminalSessionAuthorityAccess: authorityAccess,
      keepHistory: false,
      requestedAt: expect.any(Number)
    })
    wait.dispose()
  })

  it('resolves true only after the exact physical exit settles', async () => {
    const wait = prepareSshTerminalAuthorityExitWait(storeMock() as Store, target)

    let settled = false
    void wait.completion.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    publishExactExit()
    await expect(wait.completion).resolves.toBe(true)
    wait.dispose()
  })

  it('does not let another target, PTY, or incarnation complete the wait', async () => {
    const wait = prepareSshTerminalAuthorityExitWait(storeMock() as Store, target)
    let settled = false
    void wait.completion.then(() => {
      settled = true
    })

    publishSshTerminalPhysicalExit({
      targetId: 'ssh-2',
      relayPtyId: 'pty-1',
      ptyIncarnationId: 'incarnation-1',
      code: 0
    })
    publishSshTerminalPhysicalExit({
      targetId: 'ssh-1',
      relayPtyId: 'pty-2',
      ptyIncarnationId: 'incarnation-1',
      code: 0
    })
    publishSshTerminalPhysicalExit({
      targetId: 'ssh-1',
      relayPtyId: 'pty-1',
      ptyIncarnationId: 'incarnation-2',
      code: 0
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    publishExactExit()
    await expect(wait.completion).resolves.toBe(true)
    wait.dispose()
  })

  it('resolves false on timeout without clearing durable close intent', async () => {
    vi.useFakeTimers()
    const store = storeMock()
    const wait = prepareSshTerminalAuthorityExitWait(store as Store, target, 25)

    await vi.advanceTimersByTimeAsync(25)
    await expect(wait.completion).resolves.toBe(false)
    wait.dispose()

    expect(store.clearSshRemotePtyCloseRequest).not.toHaveBeenCalled()
  })

  it('disposes the observer when close-intent persistence fails', () => {
    const store = storeMock()
    vi.mocked(store.requestSshRemotePtyClose).mockImplementation(() => {
      throw new Error('disk unavailable')
    })

    expect(() => prepareSshTerminalAuthorityExitWait(store as Store, target)).toThrow(
      'disk unavailable'
    )
  })

  it('cancels only the unsent full binding and keeps cancellation disposal separate', () => {
    const store = storeMock()
    const wait = prepareSshTerminalAuthorityExitWait(store as Store, target)

    wait.cancelUnsent()

    expect(store.clearSshRemotePtyCloseRequest).toHaveBeenCalledWith(
      'ssh-1',
      'pty-1',
      authorityAccess
    )
    wait.dispose()
  })

  it('does not cancel a duplicate durable intent owned by an earlier attempt', () => {
    const store = storeMock()
    vi.mocked(store.requestSshRemotePtyClose).mockReturnValue('duplicate')
    const wait = prepareSshTerminalAuthorityExitWait(store as Store, target)

    wait.cancelUnsent()

    expect(store.clearSshRemotePtyCloseRequest).not.toHaveBeenCalled()
    wait.dispose()
  })
})

function publishExactExit(): void {
  publishSshTerminalPhysicalExit({
    targetId: target.targetId,
    relayPtyId: target.relayPtyId,
    ptyIncarnationId: target.authorityAccess.binding.ptyIncarnationId,
    code: 0
  })
}
