import type { PtySourceCreditAck } from '../shared/pty-source-credit-contract'
import type { LegacyPhysicalWorkerRpc } from './legacy-physical-worker-client'

export function publishLegacyPhysicalWorkerSourceAcknowledgement(
  rpc: LegacyPhysicalWorkerRpc,
  acknowledgement: PtySourceCreditAck,
  acknowledgementId: string
): Promise<void> {
  if (!acknowledgementId) {
    return Promise.reject(new Error('legacy physical worker ACK identity is invalid'))
  }
  const publish = rpc.notifyWithSettlement?.bind(rpc)
  if (!publish) {
    return Promise.reject(
      new Error('legacy physical worker source-credit settlement is unsupported')
    )
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (result: Readonly<{ ok: true }> | Readonly<{ ok: false; error: Error }>) => {
      if (settled) {
        return
      }
      settled = true
      if (result.ok) {
        resolve()
      } else {
        reject(result.error)
      }
    }
    try {
      publish('pty.ackData', { acknowledgements: [acknowledgement] }, settle)
    } catch (error) {
      settle({
        ok: false,
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  })
}
