import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  selectRefreshedNetworkAddress,
  type MobileNetworkInterface
} from '../settings/mobile-network-interface-selection'
import { useMobilePairingCustomAddress } from './use-mobile-pairing-custom-address'

export function useMobilePairingAddressPreference(args: {
  networkInterfaces: readonly MobileNetworkInterface[]
  onSelectionInvalidated: () => void
}): {
  selectedAddress: string | undefined
  selectAddress: (address: string) => void
  selectAddressAfterRefresh: (interfaces: readonly MobileNetworkInterface[]) => void
} {
  const { networkInterfaces, onSelectionInvalidated } = args
  const updateSettings = useAppStore((state) => state.updateSettings)
  const savedCustomAddress = useMobilePairingCustomAddress()
  const [selectedAddress, setSelectedAddress] = useState<string | undefined>(savedCustomAddress)
  const selectedAddressRef = useRef(selectedAddress)
  const selectedAddressIsManualRef = useRef(savedCustomAddress !== undefined)
  const observedCustomAddressRef = useRef(savedCustomAddress)
  const pendingCustomAddressWritesRef = useRef<(string | undefined)[]>([])

  const selectAddressAfterRefresh = useCallback(
    (interfaces: readonly MobileNetworkInterface[]): void => {
      const nextAddress = selectRefreshedNetworkAddress(
        selectedAddressRef.current,
        interfaces,
        selectedAddressIsManualRef.current
      )
      if (nextAddress === selectedAddressRef.current) {
        return
      }
      selectedAddressRef.current = nextAddress
      selectedAddressIsManualRef.current = false
      setSelectedAddress(nextAddress)
      onSelectionInvalidated()
    },
    [onSelectionInvalidated]
  )

  const selectAddress = useCallback(
    (address: string): void => {
      const isManual = !networkInterfaces.some((iface) => iface.address === address)
      selectedAddressRef.current = address
      selectedAddressIsManualRef.current = isManual
      setSelectedAddress(address)
      const customAddress = isManual ? address : undefined
      const pendingWrites = pendingCustomAddressWritesRef.current
      const effectiveCustomAddress =
        pendingWrites.length > 0 ? pendingWrites.at(-1) : observedCustomAddressRef.current
      if (customAddress !== effectiveCustomAddress) {
        pendingWrites.push(customAddress)
        void updateSettings({ mobilePairingCustomAddress: customAddress ?? null })
      }
      onSelectionInvalidated()
    },
    [networkInterfaces, onSelectionInvalidated, updateSettings]
  )

  useEffect(() => {
    if (savedCustomAddress === observedCustomAddressRef.current) {
      return
    }
    observedCustomAddressRef.current = savedCustomAddress
    const pendingWrites = pendingCustomAddressWritesRef.current
    const acknowledgedWriteIndex = pendingWrites.indexOf(savedCustomAddress)
    if (acknowledgedWriteIndex !== -1) {
      pendingWrites.splice(0, acknowledgedWriteIndex + 1)
      return
    }
    pendingWrites.length = 0
    const nextAddress =
      savedCustomAddress ?? selectRefreshedNetworkAddress(undefined, networkInterfaces)
    selectedAddressRef.current = nextAddress
    selectedAddressIsManualRef.current = savedCustomAddress !== undefined
    setSelectedAddress(nextAddress)
    onSelectionInvalidated()
  }, [networkInterfaces, onSelectionInvalidated, savedCustomAddress])

  return { selectedAddress, selectAddress, selectAddressAfterRefresh }
}
