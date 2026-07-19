import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../../store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useMobilePairingDevicePolling } from './mobile-pairing-device-polling'
import {
  selectRefreshedNetworkAddress,
  type MobileNetworkInterface
} from './mobile-network-interface-selection'
import { MobilePairingQrSection } from './MobilePairingQrSection'
import { MobilePairedDevicesSection, type PairedDevice } from './MobilePairedDevicesSection'
import { MobileAutoRestoreFitSection } from './MobileAutoRestoreFitSection'
import { MobilePairingConnectionOptions } from './MobilePairingConnectionOptions'
import { MobilePairingSetupSection } from './MobilePairingSetupSection'
import { WindowsFirewallNotice } from '../mobile/WindowsFirewallNotice'
import { translate } from '@/i18n/i18n'
import {
  effectiveMobilePairingConnectionMode,
  type MobilePairingConnectionMode
} from '../../../../shared/mobile-pairing-connection-mode'
import { useMobilePairingConnectionMode } from '../mobile/use-mobile-pairing-connection-mode'
export { getMobilePaneSearchEntries } from './mobile-pane-search'

export function MobilePane(): React.JSX.Element {
  const autoRestoreFitMs = useAppStore((s) => s.settings?.mobileAutoRestoreFitMs ?? null)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [pairingUrl, setPairingUrl] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [qrEnlarged, setQrEnlarged] = useState(false)
  const [networkInterfaces, setNetworkInterfaces] = useState<MobileNetworkInterface[]>([])
  const [selectedAddress, setSelectedAddress] = useState<string | undefined>(undefined)
  const [refreshingNetworkInterfaces, setRefreshingNetworkInterfaces] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [deviceCountAtQr, setDeviceCountAtQr] = useState<number | null>(null)
  const signedIn = useAppStore((state) => state.orcaProfileAuthStatus?.state === 'connected')
  const [connectionMode, setConnectionMode] = useMobilePairingConnectionMode()
  const qrConnectionMode = effectiveMobilePairingConnectionMode({
    preferred: connectionMode,
    signedIn
  })
  const [rotateNextQr, setRotateNextQr] = useState(false)
  const devicesRef = useRef<PairedDevice[]>([])
  const codeCopiedResetTimerRef = useRef<number | null>(null)
  const wasSignedInRef = useRef(signedIn)
  // Why: monotonically bumped per pairing request so a late getPairingQR
  // response cannot paint a stale QR after sign-out, a mode switch, or an
  // address change invalidated the request that produced it.
  const pairingRequestIdRef = useRef(0)
  // Tracks the mode we last acted on so the connectionMode effect can tell a
  // cross-window preference sync apart from our own path change.
  const handledModeRef = useRef(connectionMode)
  // Latest address without stale-closure risk inside loadNetworkInterfaces.
  const selectedAddressRef = useRef<string | undefined>(selectedAddress)
  // Ref mirrors of QR-visible / loading so invalidatePairing stays stable and
  // cannot make loadNetworkInterfaces re-fetch on every generate.
  const qrDisplayedRef = useRef(false)
  const loadingRef = useRef(false)
  const mountedRef = useMountedRef()

  useEffect(() => {
    qrDisplayedRef.current = qrDataUrl != null
  }, [qrDataUrl])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  // Why: an offer encodes a specific policy + endpoint. When the selection that
  // produced it changes, drop any displayed QR and invalidate the in-flight
  // request so a late response can't restore it; arm rotation so the next mint
  // issues a fresh credential rather than the discarded pending one.
  const invalidatePairing = useCallback((): void => {
    pairingRequestIdRef.current += 1
    const hadPending = qrDisplayedRef.current || loadingRef.current
    setQrDataUrl(null)
    setPairingUrl(null)
    setEndpoint(null)
    if (hadPending) {
      setRotateNextQr(true)
    }
  }, [])

  // Why: a Relay QR minted while signed in must not linger on a now-signed-out
  // desktop — Generate is disabled in that state. Invalidate any pending relay
  // mint too, not just a displayed QR, so a late response can't paint a Relay
  // code after sign-out. Anywhere stays selected.
  useEffect(() => {
    const wasSignedIn = wasSignedInRef.current
    wasSignedInRef.current = signedIn
    if (wasSignedIn && !signedIn && connectionMode === 'automatic') {
      invalidatePairing()
    }
  }, [signedIn, connectionMode, invalidatePairing])

  const clearCodeCopiedResetTimer = useCallback((): void => {
    if (codeCopiedResetTimerRef.current !== null) {
      window.clearTimeout(codeCopiedResetTimerRef.current)
      codeCopiedResetTimerRef.current = null
    }
  }, [])

  const loadDevices = useCallback(async () => {
    try {
      const result = await window.api.mobile.listDevices()
      if (mountedRef.current) {
        devicesRef.current = result.devices
        setDevices(result.devices)
      }
    } catch {
      // Silently fail — device list is non-critical
    }
  }, [mountedRef])

  const loadNetworkInterfaces = useCallback(
    async (opts: { notifyOnError?: boolean } = {}) => {
      setRefreshingNetworkInterfaces(true)
      try {
        const result = await window.api.mobile.listNetworkInterfaces()
        if (mountedRef.current) {
          setNetworkInterfaces(result.interfaces)
          const nextAddress = selectRefreshedNetworkAddress(
            selectedAddressRef.current,
            result.interfaces
          )
          if (nextAddress !== selectedAddressRef.current) {
            selectedAddressRef.current = nextAddress
            setSelectedAddress(nextAddress)
            // A refresh moved the active interface; invalidate so a shown QR
            // can't keep encoding the previous endpoint.
            invalidatePairing()
          }
        }
      } catch {
        if (opts.notifyOnError && mountedRef.current) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.d714614dbf',
              'Failed to refresh network interfaces'
            )
          )
        }
      } finally {
        if (mountedRef.current) {
          setRefreshingNetworkInterfaces(false)
        }
      }
    },
    [mountedRef, invalidatePairing]
  )

  const generateQR = useCallback(
    async (opts: { rotate?: boolean } = {}) => {
      const requestId = ++pairingRequestIdRef.current
      setLoading(true)
      try {
        const result = await window.api.mobile.getPairingQR({
          ...(selectedAddress ? { address: selectedAddress } : {}),
          connectionMode: qrConnectionMode,
          ...(opts.rotate || rotateNextQr ? { rotate: true } : {})
        })
        // Why: sign-out, a mode switch, or an address change bump the epoch.
        // A response for a superseded request must not paint a QR that no
        // longer matches the current selection.
        if (requestId !== pairingRequestIdRef.current) {
          return
        }
        if (result.available) {
          useAppStore.getState().recordFeatureInteraction('mobile-pairing')
          if (mountedRef.current) {
            setQrDataUrl(result.qrDataUrl)
            setPairingUrl(result.pairingUrl)
            setEndpoint(result.endpoint)
            setDeviceCountAtQr(devicesRef.current.length)
            clearCodeCopiedResetTimer()
            setCodeCopied(false)
            setRotateNextQr(false)
            void loadDevices()
          }
        } else {
          if (mountedRef.current) {
            toast.error(
              translate(
                'auto.components.settings.MobilePane.cb9067c1c1',
                'WebSocket transport is not running'
              )
            )
          }
        }
      } catch {
        if (mountedRef.current && requestId === pairingRequestIdRef.current) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.e3c427e020',
              'Failed to generate QR code'
            )
          )
        }
      } finally {
        if (mountedRef.current && requestId === pairingRequestIdRef.current) {
          setLoading(false)
        }
      }
    },
    [
      clearCodeCopiedResetTimer,
      loadDevices,
      mountedRef,
      qrConnectionMode,
      rotateNextQr,
      selectedAddress
    ]
  )

  const changeConnectionMode = useCallback(
    (nextMode: MobilePairingConnectionMode) => {
      if (nextMode === connectionMode) {
        return
      }
      // Why: remember the path so reopening Settings keeps the user's choice
      // instead of snapping back to the default.
      handledModeRef.current = nextMode
      setConnectionMode(nextMode)
      void updateSettings({ mobilePairingConnectionMode: nextMode })
      // A displayed or in-flight code encodes the old connection policy.
      invalidatePairing()
    },
    [connectionMode, invalidatePairing, updateSettings, setConnectionMode]
  )

  const handleSelectedAddressChange = useCallback(
    (address: string): void => {
      setSelectedAddress(address)
      selectedAddressRef.current = address
      // Switching endpoints: a shown QR now encodes the old address.
      invalidatePairing()
    },
    [invalidatePairing]
  )

  // Why: another window can persist a different path; the shared hook syncs
  // connectionMode here without routing through changeConnectionMode. Treat
  // that external change like a user path change so a QR for the old policy
  // can't linger. No updateSettings call here — avoids a cross-window loop.
  useEffect(() => {
    if (connectionMode === handledModeRef.current) {
      return
    }
    handledModeRef.current = connectionMode
    invalidatePairing()
  }, [connectionMode, invalidatePairing])

  useEffect(() => {
    void loadDevices()
    void loadNetworkInterfaces()
  }, [loadDevices, loadNetworkInterfaces])

  useMobilePairingDevicePolling({
    deviceCountAtQr,
    currentDeviceCount: devices.length,
    loadDevices
  })

  async function revokeDevice(deviceId: string) {
    try {
      await window.api.mobile.revokeDevice({ deviceId })
      if (mountedRef.current) {
        setDevices((prev) => {
          const nextDevices = prev.filter((d) => d.deviceId !== deviceId)
          devicesRef.current = nextDevices
          return nextDevices
        })
        toast.success(translate('auto.components.settings.MobilePane.2e3dd0bc29', 'Device revoked'))
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.settings.MobilePane.870e1b5ca5', 'Failed to revoke device')
        )
      }
    }
  }

  return (
    <div className="space-y-6">
      <MobilePairingSetupSection
        connectionMode={connectionMode}
        canGenerate={!(connectionMode === 'automatic' && !signedIn)}
        connectionPathControl={
          <MobilePairingConnectionOptions value={connectionMode} onChange={changeConnectionMode} />
        }
        networkInterfaces={networkInterfaces}
        selectedAddress={selectedAddress}
        onSelectedAddressChange={handleSelectedAddressChange}
        refreshingNetworkInterfaces={refreshingNetworkInterfaces}
        onRefreshNetworkInterfaces={() => void loadNetworkInterfaces({ notifyOnError: true })}
        loading={loading}
        hasQrCode={qrDataUrl != null}
        onGenerateQr={() => void generateQR({ rotate: qrDataUrl != null })}
      />

      <MobilePairingQrSection
        qrDataUrl={qrDataUrl}
        pairingUrl={pairingUrl}
        endpoint={endpoint}
        qrEnlarged={qrEnlarged}
        codeCopied={codeCopied}
        onQrEnlargedChange={setQrEnlarged}
        onCodeCopiedChange={setCodeCopied}
        onClearCodeCopiedTimer={clearCodeCopiedResetTimer}
      />

      <WindowsFirewallNotice pairingReady={qrDataUrl != null} address={selectedAddress} />

      <MobilePairedDevicesSection
        devices={devices}
        hasQrCode={qrDataUrl != null}
        onRevokeDevice={(deviceId) => void revokeDevice(deviceId)}
      />

      <MobileAutoRestoreFitSection
        autoRestoreFitMs={autoRestoreFitMs}
        onAutoRestoreFitChange={(ms) => void updateSettings({ mobileAutoRestoreFitMs: ms })}
      />
    </div>
  )
}
