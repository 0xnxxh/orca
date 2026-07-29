import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  loadHosts,
  removeHost,
  resolvePairingHostIdentity,
  saveHost
} from './disabled-page-host-store'

const metroSource = readFileSync(new URL('../../metro.config.js', import.meta.url), 'utf8')
const clientContextSource = readFileSync(
  new URL('./disabled-page-client-context.tsx', import.meta.url),
  'utf8'
)
const hostStoreSource = readFileSync(
  new URL('./disabled-page-host-store.ts', import.meta.url),
  'utf8'
)

describe('hosted mobile web native authority modules', () => {
  it('aliases resolved native modules only for the hosted web graph', () => {
    expect(metroSource).toContain("process.env.ORCA_EXPO_ROUTER_ROOT === 'host-web-app'")
    expect(metroSource).toContain("platform !== 'web'")
    expect(metroSource).toContain('path.resolve(resolution.filePath)')
    expect(metroSource).toContain('[nativeClientContext, disabledPageClientContext]')
    expect(metroSource).toContain('[nativeHostStore, disabledPageHostStore]')
  })

  it('keeps native transport and credential implementations outside inert modules', () => {
    expect(clientContextSource).not.toMatch(/host-logical-client|host-store|openHostLogicalClient/)
    expect(hostStoreSource).not.toMatch(
      /AsyncStorage|SecureStore|scheduleHostCredentialCleanup|orca:web-host-token:/
    )
  })

  it('returns no page-owned hosts and fails closed for credential mutations', async () => {
    await expect(loadHosts()).resolves.toEqual([])
    await expect(removeHost('host-id')).rejects.toThrow('Native host storage unavailable')
    await expect(resolvePairingHostIdentity('public-key', 'host-id')).rejects.toThrow(
      'Native host storage unavailable'
    )
    await expect(
      saveHost({
        id: 'host-id',
        name: 'Host',
        endpoint: 'wss://host.invalid',
        deviceToken: 'token',
        publicKeyB64: 'public-key',
        lastConnected: 0
      })
    ).rejects.toThrow('Native host storage unavailable')
  })
})
