import {
  CURSOR_REMOTE_MAX_AGGREGATE_BYTES,
  CURSOR_SIDECAR_MAX_BYTES
} from '../../shared/cursor-sidecar-scan'
import { throwIfAiVaultScanCancelled } from './ai-vault-scan-cancellation'

export type CursorVerifiedReadBudget = {
  chargedBytes: number
  reservedBytes: number
  changed: Promise<void>
  notifyChanged: () => void
}

export function createCursorVerifiedReadBudget(): CursorVerifiedReadBudget {
  let notifyChanged = (): void => undefined
  const changed = new Promise<void>((resolve) => {
    notifyChanged = resolve
  })
  return { chargedBytes: 0, reservedBytes: 0, changed, notifyChanged }
}

export async function reserveCursorVerifiedReadBytes(
  budget: CursorVerifiedReadBudget,
  estimatedBytes: number,
  signal?: AbortSignal
): Promise<number | null> {
  while (true) {
    throwIfAiVaultScanCancelled(signal)
    const remainingBytes = CURSOR_REMOTE_MAX_AGGREGATE_BYTES - budget.chargedBytes
    const availableBytes = remainingBytes - budget.reservedBytes
    if (availableBytes > 0 && estimatedBytes <= availableBytes) {
      const reservedBytes = Math.min(CURSOR_SIDECAR_MAX_BYTES, availableBytes)
      budget.reservedBytes += reservedBytes
      return reservedBytes
    }
    if (remainingBytes <= 0 || estimatedBytes > remainingBytes) {
      return null
    }
    await budget.changed
  }
}

export function settleCursorVerifiedReadReservation(
  budget: CursorVerifiedReadBudget,
  reservedBytes: number,
  chargedBytes: number
): void {
  budget.reservedBytes -= reservedBytes
  const available = CURSOR_REMOTE_MAX_AGGREGATE_BYTES - budget.chargedBytes - budget.reservedBytes
  budget.chargedBytes += Math.min(chargedBytes, Math.max(0, available))
  budget.notifyChanged()
  let notifyChanged = (): void => undefined
  budget.changed = new Promise<void>((resolve) => {
    notifyChanged = resolve
  })
  budget.notifyChanged = notifyChanged
}
