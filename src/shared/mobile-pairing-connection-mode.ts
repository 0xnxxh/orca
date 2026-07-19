export type MobilePairingConnectionMode = 'automatic' | 'local-only'

/**
 * Resolve the pairing path to show / remember.
 *
 * - Explicit saved preference wins (user already chose).
 * - Otherwise default to Anywhere (`automatic`). Relay still requires sign-in
 *   at QR time; the UI can keep Anywhere selected while signed out.
 */
export function resolveMobilePairingConnectionMode(
  saved: MobilePairingConnectionMode | null | undefined
): MobilePairingConnectionMode {
  return saved === 'local-only' ? 'local-only' : 'automatic'
}

/**
 * Mode encoded into a pairing QR. Anywhere cannot be committed without a
 * signed-in desktop session for Relay.
 */
export function effectiveMobilePairingConnectionMode(args: {
  preferred: MobilePairingConnectionMode
  signedIn: boolean
}): MobilePairingConnectionMode {
  if (args.preferred === 'automatic' && !args.signedIn) {
    return 'local-only'
  }
  return args.preferred
}
