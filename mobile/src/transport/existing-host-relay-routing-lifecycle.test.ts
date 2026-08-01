import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import type { HostProfile } from './types'

const hostStoreMock = vi.hoisted(() => ({ loadStoredHostIdentity: vi.fn() }))
const tokenStoreMock = vi.hoisted(() => ({ readHostDeviceToken: vi.fn() }))
const overlayStoreMock = vi.hoisted(() => ({ saveMobileRelayHostOverlay: vi.fn() }))

vi.mock('./host-store', () => hostStoreMock)
vi.mock('./host-device-token-store', () => tokenStoreMock)
vi.mock('./mobile-relay-host-overlay-store', () => overlayStoreMock)
vi.mock('./host-list-load-sharing', () => ({ dropSharedHostListLoad: vi.fn() }))

import {
  MobileRelayUpgradeHostSupersededError,
  saveExistingHostRelayRouting,
  writeExistingHostRelayCredentialBundle
} from './existing-host-relay-routing'
import { beginHostEndpointPublicationLifecycle } from './host-profile-publication'

const HOST: HostProfile = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://127.0.0.1:1',
  deviceToken: 'token-1',
  publicKeyB64: 'A'.repeat(44),
  lastConnected: 0
}

describe('existing host relay endpoint lifecycle publication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hostStoreMock.loadStoredHostIdentity.mockResolvedValue(HOST)
    tokenStoreMock.readHostDeviceToken.mockResolvedValue(HOST.deviceToken)
    overlayStoreMock.saveMobileRelayHostOverlay.mockResolvedValue(undefined)
  })

  it('rejects a credential write from a retired endpoint lifecycle', async () => {
    let releaseOldToken: ((token: string | null) => void) | null = null
    tokenStoreMock.readHostDeviceToken.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          releaseOldToken = resolve
        })
    )
    const oldGeneration = beginHostEndpointPublicationLifecycle(HOST.id)
    const writes: string[] = []
    const oldWrite = writeExistingHostRelayCredentialBundle(
      HOST,
      credentialBundle(1),
      async () => {
        writes.push('old')
      },
      oldGeneration
    )
    await vi.waitFor(() => expect(tokenStoreMock.readHostDeviceToken).toHaveBeenCalledOnce())

    const replacementGeneration = beginHostEndpointPublicationLifecycle(HOST.id)
    await writeExistingHostRelayCredentialBundle(
      HOST,
      credentialBundle(2),
      async () => {
        writes.push('replacement')
      },
      replacementGeneration
    )
    releaseOldToken?.(HOST.deviceToken)

    await expect(oldWrite).rejects.toBeInstanceOf(MobileRelayUpgradeHostSupersededError)
    expect(writes).toEqual(['replacement'])
  })

  it('rejects relay routing from a retired endpoint lifecycle', async () => {
    let releaseOldToken: ((token: string | null) => void) | null = null
    tokenStoreMock.readHostDeviceToken.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          releaseOldToken = resolve
        })
    )
    const oldGeneration = beginHostEndpointPublicationLifecycle(HOST.id)
    const stalePublication = saveExistingHostRelayRouting(
      relayHostProfile('AbCdEf0123_-old9'),
      undefined,
      oldGeneration
    )
    await vi.waitFor(() => expect(tokenStoreMock.readHostDeviceToken).toHaveBeenCalledOnce())

    const replacementGeneration = beginHostEndpointPublicationLifecycle(HOST.id)
    await saveExistingHostRelayRouting(
      relayHostProfile('AbCdEf0123_-new9'),
      undefined,
      replacementGeneration
    )
    releaseOldToken?.(HOST.deviceToken)

    await expect(stalePublication).rejects.toBeInstanceOf(MobileRelayUpgradeHostSupersededError)
    expect(overlayStoreMock.saveMobileRelayHostOverlay).toHaveBeenCalledOnce()
    expect(overlayStoreMock.saveMobileRelayHostOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ relayHostId: 'AbCdEf0123_-new9' })
    )
  })
})

function credentialBundle(version: number): MobileRelayCredentialBundle {
  return {
    v: 1,
    hostId: HOST.id,
    deviceToken: HOST.deviceToken,
    current: {
      token: String.fromCharCode(64 + version).repeat(43),
      hash: String.fromCharCode(66 + version).repeat(43),
      version,
      expiresAt: version
    }
  }
}

function relayHostProfile(relayHostId: string): HostProfile {
  return {
    ...HOST,
    endpoints: [
      { id: 'direct-primary', kind: 'lan', url: HOST.endpoint },
      { id: 'relay-primary', kind: 'relay', url: `wss://relay.invalid/${relayHostId}` }
    ],
    relayHostId,
    relay: {
      v: 1,
      directorUrl: 'https://relay.invalid',
      cellUrl: 'https://relay.invalid',
      assignmentEpoch: 1,
      relayHostId,
      e2eeFraming: 2
    }
  }
}
