import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import {
  killListedPty,
  listedPtyIdentityKey,
  listedPtyIncarnationId
} from './pty-listed-session-kill'

const authorityAccess: TerminalSessionAuthorityPtyAccess = {
  namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
  pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
  binding: {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
}
const mutationRouteToken = Object.freeze({})

describe('listed PTY kill', () => {
  it('uses full authority access without falling back to incarnation-only mutation', async () => {
    const killAuthorityExact = vi.fn(async () => true)
    const killExact = vi.fn(async () => true)

    await expect(
      killListedPty(
        {
          getPtyMutationRouteToken: () => mutationRouteToken,
          killAuthorityExact,
          killExact
        },
        {
          id: 'pty-1',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess,
          mutationRouteToken
        },
        { immediate: true }
      )
    ).resolves.toBe(true)

    expect(killAuthorityExact).toHaveBeenCalledWith('pty-1', authorityAccess, {
      immediate: true
    })
    expect(killExact).not.toHaveBeenCalled()
  })

  it('rejects conflicting authority and incarnation evidence without mutation', async () => {
    const killAuthorityExact = vi.fn(async () => true)
    const killExact = vi.fn(async () => true)
    const target = {
      id: 'pty-1',
      incarnationId: 'incarnation-2',
      terminalSessionAuthorityAccess: authorityAccess,
      mutationRouteToken
    }

    await expect(
      killListedPty(
        { getPtyMutationRouteToken: () => mutationRouteToken, killAuthorityExact, killExact },
        target,
        {}
      )
    ).resolves.toBe(false)
    expect(killAuthorityExact).not.toHaveBeenCalled()
    expect(killExact).not.toHaveBeenCalled()
    expect(listedPtyIdentityKey(target)).toBeNull()
    expect(listedPtyIncarnationId(target)).toBeNull()
  })

  it('uses incarnation-exact mutation and rejects identity-free inventory', async () => {
    const killExact = vi.fn(async () => true)

    await expect(
      killListedPty(
        { getPtyMutationRouteToken: () => mutationRouteToken, killExact },
        { id: 'pty-1', incarnationId: 'incarnation-1', mutationRouteToken },
        {}
      )
    ).resolves.toBe(true)
    await expect(
      killListedPty(
        { getPtyMutationRouteToken: () => mutationRouteToken, killExact },
        { id: 'pty-2', mutationRouteToken },
        {}
      )
    ).resolves.toBe(false)

    expect(killExact).toHaveBeenCalledTimes(1)
    expect(killExact).toHaveBeenCalledWith('pty-1', 'incarnation-1', {})
  })

  it('rejects missing or replaced inventory routes without exact mutation', async () => {
    const killExact = vi.fn(async () => true)
    const currentRouteToken = Object.freeze({})
    const provider = {
      getPtyMutationRouteToken: vi.fn(() => currentRouteToken),
      killExact
    }

    await expect(
      killListedPty(provider, { id: 'pty-1', incarnationId: 'incarnation-1' }, {})
    ).resolves.toBe(false)
    await expect(
      killListedPty(
        provider,
        {
          id: 'pty-1',
          incarnationId: 'incarnation-1',
          mutationRouteToken: Object.freeze({})
        },
        {}
      )
    ).resolves.toBe(false)

    expect(killExact).not.toHaveBeenCalled()
  })

  it('includes the complete authority route in identity keys', () => {
    const original = listedPtyIdentityKey({
      id: 'pty-1',
      terminalSessionAuthorityAccess: authorityAccess
    })
    const successor = listedPtyIdentityKey({
      id: 'pty-1',
      terminalSessionAuthorityAccess: {
        ...authorityAccess,
        pane: { ...authorityAccess.pane, paneGenerationId: 'renderer:2' }
      }
    })

    expect(original).not.toBeNull()
    expect(successor).not.toBe(original)
  })
})
