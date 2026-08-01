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
  MobileRelayUpgradeLifecycleRetiredError,
  MobileRelayUpgradeHostSupersededError,
  saveExistingHostRelayRouting,
  writeExistingHostRelayCredentialBundle
} from './existing-host-relay-routing'
import {
  beginHostEndpointPublicationLifecycle,
  getHostProfilePublicationRevision,
  publishHostProfileTransaction
} from './host-profile-publication'

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

    await expect(oldWrite).rejects.toBeInstanceOf(MobileRelayUpgradeLifecycleRetiredError)
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

    await expect(stalePublication).rejects.toBeInstanceOf(MobileRelayUpgradeLifecycleRetiredError)
    expect(overlayStoreMock.saveMobileRelayHostOverlay).toHaveBeenCalledOnce()
    expect(overlayStoreMock.saveMobileRelayHostOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ relayHostId: 'AbCdEf0123_-new9' })
    )
  })

  it('rechecks credential publication after its metadata read', async () => {
    let releaseMetadata: ((host: HostProfile | null) => void) | null = null
    hostStoreMock.loadStoredHostIdentity.mockResolvedValueOnce(HOST).mockImplementationOnce(
      () =>
        new Promise<HostProfile | null>((resolve) => {
          releaseMetadata = resolve
        })
    )
    const oldGeneration = beginHostEndpointPublicationLifecycle(HOST.id)
    const writeBundle = vi.fn(async () => {})
    const oldWrite = writeExistingHostRelayCredentialBundle(
      HOST,
      credentialBundle(1),
      writeBundle,
      oldGeneration
    )
    await vi.waitFor(() => expect(hostStoreMock.loadStoredHostIdentity).toHaveBeenCalledTimes(2))

    beginHostEndpointPublicationLifecycle(HOST.id)
    releaseMetadata?.(HOST)

    await expect(oldWrite).rejects.toBeInstanceOf(MobileRelayUpgradeLifecycleRetiredError)
    expect(writeBundle).not.toHaveBeenCalled()
  })

  it('rechecks routing publication after its credential write', async () => {
    let releaseCredentialWrite: (() => void) | null = null
    let markCredentialWriteStarted: (() => void) | null = null
    const credentialWriteStarted = new Promise<void>((resolve) => {
      markCredentialWriteStarted = resolve
    })
    const oldGeneration = beginHostEndpointPublicationLifecycle(HOST.id)
    const oldWrite = saveExistingHostRelayRouting(
      relayHostProfile('AbCdEf0123_-old9'),
      async () => {
        markCredentialWriteStarted?.()
        await new Promise<void>((resolve) => {
          releaseCredentialWrite = resolve
        })
      },
      oldGeneration
    )
    await credentialWriteStarted

    beginHostEndpointPublicationLifecycle(HOST.id)
    releaseCredentialWrite?.()

    await expect(oldWrite).rejects.toBeInstanceOf(MobileRelayUpgradeLifecycleRetiredError)
    expect(overlayStoreMock.saveMobileRelayHostOverlay).not.toHaveBeenCalled()
  })

  it('rejects an old credential write that starts during same-host re-pair publication', async () => {
    let releaseReplacement: (() => void) | null = null
    let markReplacementStarted: (() => void) | null = null
    const replacementStarted = new Promise<void>((resolve) => {
      markReplacementStarted = resolve
    })
    const replacementPending = new Promise<void>((resolve) => {
      releaseReplacement = resolve
    })
    const replacementHost = { ...HOST, deviceToken: 'token-2' }
    const replacement = publishHostProfileTransaction(
      replacementHost,
      async () => {
        markReplacementStarted?.()
        await replacementPending
      },
      async () => {
        hostStoreMock.loadStoredHostIdentity.mockResolvedValue(replacementHost)
        tokenStoreMock.readHostDeviceToken.mockResolvedValue(replacementHost.deviceToken)
      }
    )
    await replacementStarted

    const writeBundle = vi.fn(async () => {})
    const staleWrite = writeExistingHostRelayCredentialBundle(
      HOST,
      credentialBundle(1),
      writeBundle
    )
    await vi.waitFor(() => expect(tokenStoreMock.readHostDeviceToken).toHaveBeenCalledOnce())
    releaseReplacement?.()

    await replacement
    await expect(staleWrite).rejects.toBeInstanceOf(MobileRelayUpgradeHostSupersededError)
    expect(writeBundle).not.toHaveBeenCalled()
  })

  it('binds an endpoint lifecycle to the profile revision before same-identity recovery', async () => {
    let releaseRecovery: (() => void) | null = null
    let markRecoveryStarted: (() => void) | null = null
    const recoveryStarted = new Promise<void>((resolve) => {
      markRecoveryStarted = resolve
    })
    const recoveryPending = new Promise<void>((resolve) => {
      releaseRecovery = resolve
    })
    const oldLifecycle = beginHostEndpointPublicationLifecycle(HOST.id)
    const recovery = publishHostProfileTransaction(
      HOST,
      async () => {
        markRecoveryStarted?.()
        await recoveryPending
      },
      async () => {}
    )
    await recoveryStarted

    const writeBundle = vi.fn(async () => {})
    const staleWrite = writeExistingHostRelayCredentialBundle(
      HOST,
      credentialBundle(1),
      writeBundle,
      oldLifecycle
    )
    releaseRecovery?.()

    await recovery
    await expect(staleWrite).rejects.toBeInstanceOf(MobileRelayUpgradeLifecycleRetiredError)
    expect(writeBundle).not.toHaveBeenCalled()
  })

  it('keeps the current endpoint lifecycle valid when profile publication fails', async () => {
    const lifecycle = beginHostEndpointPublicationLifecycle(HOST.id)
    const revision = getHostProfilePublicationRevision(HOST.id)
    const failedPublication = publishHostProfileTransaction(
      HOST,
      async () => {
        throw new Error('keychain locked')
      },
      async () => {}
    )

    await expect(failedPublication).rejects.toThrow('keychain locked')
    expect(getHostProfilePublicationRevision(HOST.id)).toBe(revision)

    const writeBundle = vi.fn(async () => {})
    await writeExistingHostRelayCredentialBundle(HOST, credentialBundle(1), writeBundle, lifecycle)
    expect(writeBundle).toHaveBeenCalledOnce()
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
