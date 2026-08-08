import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { IPtyProvider } from './types'
import {
  clearPtyMutation,
  killPtyMutation,
  resizePtyMutation,
  resolveAdministrativePtyMutationDispatch,
  resolveRendererPtyMutationDispatch,
  signalPtyMutation,
  writePtyMutation
} from './pty-mutation-dispatch'

function provider(mode: 'legacy' | 'exact' | 'unavailable'): IPtyProvider {
  return { getPtyMutationMode: vi.fn(() => mode) } as unknown as IPtyProvider
}

const current = {
  incarnationId: 'incarnation-current',
  paneGeneration: 7,
  mutationLeaseId: 'lease-current'
}

const authorityAccess: TerminalSessionAuthorityPtyAccess = {
  namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
  pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:7' },
  binding: {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: current.incarnationId
  }
}

describe('renderer PTY mutation dispatch', () => {
  it('preserves explicitly negotiated legacy providers', () => {
    expect(
      resolveRendererPtyMutationDispatch({
        provider: provider('legacy'),
        id: 'pty-1',
        currentIdentity: current,
        requestedIdentity: null
      })
    ).toEqual({ mode: 'legacy' })
  })

  it('rejects exact mode without a full authority binding', () => {
    expect(
      resolveRendererPtyMutationDispatch({
        provider: provider('exact'),
        id: 'pty-1',
        currentIdentity: current,
        requestedIdentity: current
      })
    ).toEqual({ mode: 'rejected' })
    for (const requestedIdentity of [
      null,
      { ...current, incarnationId: 'incarnation-stale' },
      { ...current, paneGeneration: 6 },
      { ...current, mutationLeaseId: 'lease-stale' }
    ]) {
      expect(
        resolveRendererPtyMutationDispatch({
          provider: provider('exact'),
          id: 'pty-1',
          currentIdentity: current,
          requestedIdentity
        })
      ).toEqual({ mode: 'rejected' })
    }
  })

  it('fails closed when authority requires exact mutations but identity is unavailable', () => {
    expect(
      resolveRendererPtyMutationDispatch({
        provider: provider('unavailable'),
        id: 'pty-1',
        currentIdentity: current,
        requestedIdentity: current
      })
    ).toEqual({ mode: 'rejected' })
  })

  it('requires provider authority for administrative exact operations', () => {
    expect(
      resolveAdministrativePtyMutationDispatch({
        provider: provider('exact'),
        id: 'pty-1',
        currentIdentity: current
      })
    ).toEqual({ mode: 'rejected' })
    expect(
      resolveAdministrativePtyMutationDispatch({
        provider: provider('legacy'),
        id: 'pty-1',
        currentIdentity: undefined
      })
    ).toEqual({ mode: 'legacy' })
    expect(
      resolveAdministrativePtyMutationDispatch({
        provider: provider('exact'),
        id: 'pty-1',
        currentIdentity: undefined
      })
    ).toEqual({ mode: 'rejected' })
  })

  it('captures full authority and rejects a binding changed after admission', () => {
    const exactProvider = {
      getPtyMutationMode: () => 'exact',
      getTerminalSessionAuthorityAccess: () => authorityAccess
    } as unknown as IPtyProvider
    expect(
      resolveRendererPtyMutationDispatch({
        provider: exactProvider,
        id: 'pty-1',
        currentIdentity: current,
        requestedIdentity: current
      })
    ).toEqual({ mode: 'exact', identity: current, authorityAccess })
    expect(
      resolveRendererPtyMutationDispatch({
        provider: exactProvider,
        id: 'pty-1',
        currentIdentity: current,
        requestedIdentity: current,
        requestedAuthorityAccess: {
          ...authorityAccess,
          pane: { ...authorityAccess.pane, paneGenerationId: 'renderer:6' }
        }
      })
    ).toEqual({ mode: 'rejected' })
  })

  it('routes every authoritative mutation through the full binding', async () => {
    const exactProvider = {
      writeAuthorityExact: vi.fn(() => true),
      resizeAuthorityExact: vi.fn(() => true),
      killAuthorityExact: vi.fn(async () => true),
      sendSignalAuthorityExact: vi.fn(async () => true),
      clearBufferAuthorityExact: vi.fn(async () => true),
      writeExact: vi.fn(),
      resizeExact: vi.fn(),
      killExact: vi.fn(),
      sendSignalExact: vi.fn(),
      clearBufferExact: vi.fn()
    } as unknown as IPtyProvider
    const dispatch = { mode: 'exact' as const, identity: current, authorityAccess }

    expect(writePtyMutation(exactProvider, 'pty-1', dispatch, 'input')).toBe(true)
    expect(resizePtyMutation(exactProvider, 'pty-1', dispatch, 120, 40)).toBe(true)
    await expect(killPtyMutation(exactProvider, 'pty-1', dispatch, {})).resolves.toBe(true)
    await expect(signalPtyMutation(exactProvider, 'pty-1', dispatch, 'SIGTERM')).resolves.toBe(true)
    await expect(clearPtyMutation(exactProvider, 'pty-1', dispatch)).resolves.toBe(true)

    expect(exactProvider.writeAuthorityExact).toHaveBeenCalledWith(
      'pty-1',
      authorityAccess,
      'input'
    )
    expect(exactProvider.resizeAuthorityExact).toHaveBeenCalledWith(
      'pty-1',
      authorityAccess,
      120,
      40
    )
    expect(exactProvider.killAuthorityExact).toHaveBeenCalledWith('pty-1', authorityAccess, {})
    expect(exactProvider.sendSignalAuthorityExact).toHaveBeenCalledWith(
      'pty-1',
      authorityAccess,
      'SIGTERM'
    )
    expect(exactProvider.clearBufferAuthorityExact).toHaveBeenCalledWith('pty-1', authorityAccess)
    expect(exactProvider.writeExact).not.toHaveBeenCalled()
    expect(exactProvider.resizeExact).not.toHaveBeenCalled()
    expect(exactProvider.killExact).not.toHaveBeenCalled()
  })
})
