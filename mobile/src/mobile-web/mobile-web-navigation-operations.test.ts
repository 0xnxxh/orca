import { describe, expect, it, vi } from 'vitest'
import { executeMobileWebNavigationOperation } from './mobile-web-navigation-operations'

describe('mobile web navigation operations', () => {
  it('routes only to named native-shell destinations', async () => {
    const authority = navigationAuthority()

    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'A'.repeat(22),
        operation: 'route',
        payload: { destination: 'pairingRepair' },
        authority
      })
    ).resolves.toBeNull()

    expect(authority.route).toHaveBeenCalledWith('pairingRepair', 'A'.repeat(22))
    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'B'.repeat(22),
        operation: 'route',
        payload: { destination: 'https://attacker.invalid' },
        authority
      })
    ).rejects.toBeTruthy()
  })

  it('requires a recent native-observed gesture for reconnect and removal', async () => {
    const authority = navigationAuthority(false)

    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'C'.repeat(22),
        operation: 'reconnect',
        payload: {},
        authority
      })
    ).rejects.toMatchObject({ code: 'permission_required' })
    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'D'.repeat(22),
        operation: 'removeHost',
        payload: { confirmation: 'remove-paired-host' },
        authority
      })
    ).rejects.toMatchObject({ code: 'permission_required' })
    expect(authority.reconnect).not.toHaveBeenCalled()
    expect(authority.removeHost).not.toHaveBeenCalled()
  })

  it('requires a recent native-observed gesture before opening native settings', async () => {
    const deniedAuthority = navigationAuthority(false)

    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'E'.repeat(22),
        operation: 'route',
        payload: { destination: 'terminalSettings' },
        authority: deniedAuthority
      })
    ).rejects.toMatchObject({ code: 'permission_required' })
    expect(deniedAuthority.route).not.toHaveBeenCalled()

    const allowedAuthority = navigationAuthority()
    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'F'.repeat(22),
        operation: 'route',
        payload: { destination: 'terminalSettings' },
        authority: allowedAuthority
      })
    ).resolves.toBeNull()
    expect(allowedAuthority.route).toHaveBeenCalledWith('terminalSettings', 'F'.repeat(22))
  })

  it('removes the native-selected host without accepting page identity', async () => {
    const authority = navigationAuthority()

    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'G'.repeat(22),
        operation: 'removeHost',
        payload: { confirmation: 'remove-paired-host' },
        authority
      })
    ).resolves.toBeNull()

    expect(authority.removeHost).toHaveBeenCalledWith()
    await expect(
      executeMobileWebNavigationOperation({
        requestId: 'H'.repeat(22),
        operation: 'removeHost',
        payload: { confirmation: 'remove-paired-host', hostId: 'attacker-host' },
        authority
      })
    ).rejects.toBeTruthy()
  })
})

function navigationAuthority(hasRecentUserGesture = true) {
  return {
    route: vi.fn(),
    reconnect: vi.fn(),
    removeHost: vi.fn(),
    consumeRecentUserGesture: vi.fn(() => hasRecentUserGesture)
  }
}
