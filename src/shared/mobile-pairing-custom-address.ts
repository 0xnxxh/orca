import { parseManualNetworkAddress } from './network/manual-address'

export function normalizeMobilePairingCustomAddress(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const parsed = parseManualNetworkAddress(value)
  return parsed.ok ? parsed.address : null
}
