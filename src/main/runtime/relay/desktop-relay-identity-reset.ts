import type { OrcaRuntimeRpcServer } from '../runtime-rpc'
import type { RelayDemandLedger } from './relay-demand-ledger'
import type { RelaySessionBroker } from './relay-session-broker'
import type { RelayRevokeOutbox, RelayRevokeOutboxItem } from './relay-revoke-outbox'
import { deriveRelayHostId } from './relay-http-client'

type RelayIdentityResetRuntime = Partial<Pick<OrcaRuntimeRpcServer, 'isIdentityResetInProgress'>>

type RelayTransientDemand = <T>(key: string, operation: () => Promise<T>) => Promise<T>

export function assertDesktopRelayIdentityResetOpen(runtimeRpc: RelayIdentityResetRuntime): void {
  if (runtimeRpc.isIdentityResetInProgress?.() === true) {
    throw new Error('identity_reset_in_progress')
  }
}

export function completeDesktopRelayIdentityReset(
  options: Readonly<{
    runtimeRpc: Pick<OrcaRuntimeRpcServer, 'getE2EEKeypair'>
    demandLedger: RelayDemandLedger
    fenceAndCloseNow(): void
    refreshDemand(): void
  }>
): void {
  const keypair = options.runtimeRpc.getE2EEKeypair()
  if (!keypair) {
    return
  }
  options.demandLedger.setRelayHostId(deriveRelayHostId(keypair.publicKey))
  options.fenceAndCloseNow()
  options.refreshDemand()
}

export async function awaitDesktopRelayIdentityResetRevocations(
  items: readonly RelayRevokeOutboxItem[],
  options: Readonly<{
    revokeOutbox: RelayRevokeOutbox
    withTransientDemand: RelayTransientDemand
    requireActiveBroker(): Promise<RelaySessionBroker>
    refreshDemand(): void
  }>
): Promise<void> {
  if (items.length === 0) {
    return
  }
  await options.withTransientDemand('identity-reset-revocations', async () => {
    const broker = await options.requireActiveBroker()
    for (const item of items) {
      if (broker.hostId !== item.relayHostId || broker.ownerIdentityKey !== item.ownerIdentityKey) {
        throw new Error('relay_revoke_identity_unavailable')
      }
      await broker.revokeDevice(item.relayDeviceId, item.reqId)
      options.revokeOutbox.remove(item.reqId)
    }
    options.refreshDemand()
  })
}
