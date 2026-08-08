import type { MobilePairingConnectionContext, OrcaRuntimeRpcServer } from '../runtime-rpc'
import type {
  DeviceCredentialInstalled,
  PairingGetEndpointsParams,
  PairingGetEndpointsResult,
  PairingProvisionRelayParams
} from '../../../shared/mobile-relay-credential-contract'
import type { PairingRelay } from '../../../shared/mobile-relay-pairing-offer'
import type { RelaySessionBroker } from './relay-session-broker'
import type { RelayDeviceBinding } from './relay-revoke-outbox'
import { assertDesktopRelayIdentityResetOpen } from './desktop-relay-identity-reset'

type RelayTransientDemand = <T>(key: string, operation: () => Promise<T>) => Promise<T>

export type DesktopRelayPairingOperations = Readonly<{
  runtimeRpc: Pick<
    OrcaRuntimeRpcServer,
    'getDeviceRegistry' | 'setMobileRelayBinding' | 'isIdentityResetInProgress'
  >
  withTransientDemand: RelayTransientDemand
  activeBrokerForDemand(): Promise<RelaySessionBroker | null>
  requireActiveBroker(): Promise<RelaySessionBroker>
  requireMobileDevice(deviceId: string): void
  assertRelayHost(context: MobilePairingConnectionContext, broker: RelaySessionBroker): void
  refreshDemand(): void
}>

export async function createDesktopPairingRelay(
  relayDeviceId: string,
  options: DesktopRelayPairingOperations
): Promise<{ relay: PairingRelay; binding: RelayDeviceBinding }> {
  assertDesktopRelayIdentityResetOpen(options.runtimeRpc)
  return await options.withTransientDemand(`pairing:${relayDeviceId}`, async () => {
    const broker = await options.requireActiveBroker()
    const relay = await broker.createPairingRelay(relayDeviceId)
    return {
      relay,
      binding: {
        relayHostId: broker.hostId,
        relayDeviceId,
        ownerIdentityKey: broker.ownerIdentityKey,
        inviteExpiresAt: relay.inviteExpiresAt
      }
    }
  })
}

export async function getDesktopPairingEndpoints(
  context: MobilePairingConnectionContext,
  params: PairingGetEndpointsParams,
  options: DesktopRelayPairingOperations
): Promise<PairingGetEndpointsResult> {
  assertDesktopRelayIdentityResetOpen(options.runtimeRpc)
  options.requireMobileDevice(context.deviceId)
  if (
    options.runtimeRpc.getDeviceRegistry()?.getMobilePairingConnectionMode(context.deviceId) ===
    'local-only'
  ) {
    return { v: 1, relay: null }
  }
  return await options.withTransientDemand(`endpoints:${context.deviceId}`, async () => {
    const broker = await options.activeBrokerForDemand()
    if (!broker?.endpoint) {
      return { v: 1, relay: null }
    }
    options.assertRelayHost(context, broker)
    const result: PairingGetEndpointsResult = { v: 1, relay: broker.endpoint }
    if (params.installReqId) {
      result.installStatus = await broker.credentialInstallStatus(
        context.deviceId,
        params.installReqId
      )
    }
    if (params.resumeConfirmReqId) {
      if (
        context.transport.transport !== 'relay' ||
        context.transport.credentialKind !== 'resume'
      ) {
        throw new Error('resume_confirmation_unavailable')
      }
      result.resumeConfirmation = await broker.confirmResume(
        context.transport.basisConnId,
        params.resumeConfirmReqId
      )
    }
    return result
  })
}

export async function provisionDesktopRelay(
  context: MobilePairingConnectionContext,
  params: PairingProvisionRelayParams,
  options: DesktopRelayPairingOperations
): Promise<DeviceCredentialInstalled> {
  assertDesktopRelayIdentityResetOpen(options.runtimeRpc)
  options.requireMobileDevice(context.deviceId)
  if (
    options.runtimeRpc.getDeviceRegistry()?.getMobilePairingConnectionMode(context.deviceId) ===
    'local-only'
  ) {
    throw new Error('relay_disabled_for_device')
  }
  return await options.withTransientDemand(`provision:${context.deviceId}`, async () => {
    const broker = await options.requireActiveBroker()
    if (!broker.endpoint) {
      throw new Error('relay_control_not_active')
    }
    options.assertRelayHost(context, broker)
    const authorization = pairingAuthorizationForContext(context, broker.hostId)
    if (!authorization) {
      // Why: a resume splice proves renewal through confirmation; it cannot be repurposed as either of the two initial-install authorization modes.
      throw new Error('relay_provision_authorization_unavailable')
    }
    if (
      !options.runtimeRpc.setMobileRelayBinding(context.deviceId, {
        relayHostId: broker.hostId,
        relayDeviceId: context.deviceId,
        ownerIdentityKey: broker.ownerIdentityKey
      })
    ) {
      throw new Error('mobile_device_not_found')
    }
    options.refreshDemand()
    return await broker.installCredential(context.deviceId, params, authorization)
  })
}

function pairingAuthorizationForContext(
  context: MobilePairingConnectionContext,
  relayHostId: string
):
  | { mode: 'authenticated-direct'; directAuthId: string }
  | {
      mode: 'relay-basis'
      basisConnId: string
    }
  | null {
  if (context.transport.transport === 'direct') {
    return { mode: 'authenticated-direct', directAuthId: context.connectionId }
  }
  if (context.transport.relayHostId !== relayHostId) {
    throw new Error('stale_relay_connection')
  }
  return context.transport.credentialKind === 'invite'
    ? { mode: 'relay-basis', basisConnId: context.transport.basisConnId }
    : null
}
