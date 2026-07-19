import { useEffect, useRef } from 'react'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

type MutableRef<T> = { current: T }

/**
 * Keeps the displayed pairing QR consistent with the selected path and sign-in
 * state. Signing out of Anywhere clears the Relay QR (Step 2 does not re-mint a
 * local-only code under the Relay label), signing in mints Relay, and a path
 * change (local or cross-window) invalidates the encoded policy — otherwise the
 * shown code silently mismatches what it actually encodes.
 */
export function useMobilePairingQrInvalidation(params: {
  connectionMode: MobilePairingConnectionMode
  signedIn: boolean
  pairLoading: boolean
  hasGeneratedRef: MutableRef<boolean>
  pairingRequestIdRef: MutableRef<number>
  setPairQrDataUrl: (value: string | null) => void
  setPairingUrl: (value: string | null) => void
  setPairLoading: (value: boolean) => void
  regenerate: (mode: MobilePairingConnectionMode) => void
}): void {
  const {
    connectionMode,
    signedIn,
    pairLoading,
    hasGeneratedRef,
    pairingRequestIdRef,
    setPairQrDataUrl,
    setPairingUrl,
    setPairLoading,
    regenerate
  } = params
  const wasSignedInRef = useRef(signedIn)
  // Tracks the mode we last acted on so the mode effect can tell a cross-window
  // preference sync apart from an already-handled change.
  const handledModeRef = useRef(connectionMode)

  // Sign-in/out edges on Anywhere: signing out clears the Relay QR without
  // re-minting (a local-only code must not appear under the Relay label);
  // signing in mints Relay. Anywhere stays selected across both edges. Clear
  // loading too so a superseded in-flight generate can't leave a stuck spinner.
  useEffect(() => {
    const wasSignedIn = wasSignedInRef.current
    wasSignedInRef.current = signedIn
    if (connectionMode !== 'automatic' || !hasGeneratedRef.current || wasSignedIn === signedIn) {
      return
    }
    pairingRequestIdRef.current += 1
    hasGeneratedRef.current = false
    setPairingUrl(null)
    setPairQrDataUrl(null)
    if (signedIn) {
      regenerate(connectionMode)
    } else {
      setPairLoading(false)
    }
  }, [
    connectionMode,
    signedIn,
    hasGeneratedRef,
    pairingRequestIdRef,
    setPairQrDataUrl,
    setPairingUrl,
    setPairLoading,
    regenerate
  ])

  // Any path change — a user pick or another window persisting a new default —
  // invalidates the prior request before rotating so a late response cannot
  // restore a QR for the old policy. No updateSettings here (the caller/other
  // window already wrote it) so there is no cross-window loop.
  useEffect(() => {
    if (connectionMode === handledModeRef.current) {
      return
    }
    handledModeRef.current = connectionMode
    pairingRequestIdRef.current += 1
    const shouldRegenerate = hasGeneratedRef.current || pairLoading
    hasGeneratedRef.current = false
    setPairingUrl(null)
    setPairQrDataUrl(null)
    if (shouldRegenerate) {
      regenerate(connectionMode)
    } else {
      // No re-mint pending; drop any stray spinner so the new path starts clean.
      setPairLoading(false)
    }
  }, [
    connectionMode,
    pairLoading,
    hasGeneratedRef,
    pairingRequestIdRef,
    setPairQrDataUrl,
    setPairingUrl,
    setPairLoading,
    regenerate
  ])
}
