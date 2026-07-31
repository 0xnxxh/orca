import { useAppStore } from '@/store'
import { normalizeMobilePairingCustomAddress } from '../../../../shared/mobile-pairing-custom-address'

export function useMobilePairingCustomAddress(): string | undefined {
  const savedAddress = useAppStore((state) => state.settings?.mobilePairingCustomAddress)
  return normalizeMobilePairingCustomAddress(savedAddress) ?? undefined
}
