import { useEffect, useRef } from 'react'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

type MutableRef<T> = { current: T }

/**
 * Keeps the displayed pairing QR consistent with the selected path and sign-in
 * state. A Relay offer's effective mode flips with sign-in, and a path change
 * (local or cross-window) invalidates the encoded policy, so both must re-mint
 * or the shown code silently mismatches what it actually encodes.
 */
export function useMobilePairingQrInvalidation(params: {
  connectionMode: MobilePairingConnectionMode
  signedIn: boolean
  pairLoading: boolean
  hasGeneratedRef: MutableRef<boolean>
  pairingRequestIdRef: MutableRef<number>
  setPairQrDataUrl: (value: string | null) => void
  setPairingUrl: (value: string | null) => void
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
    regenerate
  } = params
  const wasSignedInRef = useRef(signedIn)
  // Tracks the mode we last acted on so the mode effect can tell a cross-window
  // preference sync apart from an already-handled change.
  const handledModeRef = useRef(connectionMode)

  // Sign-in/out edges: signing out drops the Relay QR to a local-only fallback
  // (the Step 2 auto-generate effect re-mints it); signing in upgrades that
  // fallback back to Relay. Anywhere stays selected across both edges.
  useEffect(() => {
    const wasSignedIn = wasSignedInRef.current
    wasSignedInRef.current = signedIn
    if (connectionMode !== 'automatic' || !hasGeneratedRef.current || wasSignedIn === signedIn) {
      return
    }
    pairingRequestIdRef.current += 1
    hasGeneratedRef.current = false
    setPairingUrl(null)
    if (signedIn) {
      regenerate(connectionMode)
    } else {
      setPairQrDataUrl(null)
    }
  }, [
    connectionMode,
    signedIn,
    hasGeneratedRef,
    pairingRequestIdRef,
    setPairQrDataUrl,
    setPairingUrl,
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
    if (shouldRegenerate) {
      regenerate(connectionMode)
    }
  }, [connectionMode, pairLoading, hasGeneratedRef, pairingRequestIdRef, setPairingUrl, regenerate])
}
