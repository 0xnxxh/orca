export const PTY_CONSUMER_SESSION_PROTOCOL_VERSION = 1
export const PTY_CONSUMER_OWNER_GRACE_MS = 30_000
export const PTY_CONSUMER_STALE_OWNER_RECOVERY_ERROR = -32041
// Why: recovery is blocked only while the incumbent owner's grant publication is still settling — a
// window bounded by one response write, so the client may retry within a short budget.
export const PTY_CONSUMER_OWNER_RECOVERY_PENDING_ERROR = -32042
export const PTY_CONSUMER_OWNER_RECOVERY_SUPERSEDED_ERROR = -32043
// Why two codes, not one message: the dispatcher transports only code and message, and the two
// holders need opposite client behavior — an attached incumbent blocks, a disconnected one is transient.
export const PTY_CONSUMER_OWNER_HELD_ATTACHED_ERROR = -32044
export const PTY_CONSUMER_OWNER_HELD_DISCONNECTED_ERROR = -32045
// Why: a disconnected incumbent keeps at most this much of its remaining grace once a different
// owner-capable client asks, so admission converges inside one bounded retry instead of the full grace.
export const PTY_CONSUMER_OWNER_HELD_GRACE_FLOOR_MS = 250

export type PtyConsumerRole = 'session-owner' | 'subscriber'

export type PtyConsumerSessionHello = {
  clientInstanceId: string
  requestedRole: PtyConsumerRole
  resume?: {
    ownerGeneration: number
    ownerLease: string
  }
  capabilities?: {
    outputFlowControl?: {
      versions: number[]
      requestedWindowSu: number
    }
  }
}

export type PtyConsumerSessionGrant = {
  protocolVersion: typeof PTY_CONSUMER_SESSION_PROTOCOL_VERSION
  serverBuildId: string
  clientGeneration: number
  role: PtyConsumerRole
  ownerGeneration?: number
  ownerLease?: string
  // Why: always present on a 'session-owner' grant, absent on a subscriber grant. `false` means the
  // relay minted a fresh claim, so the client's checkpoints for the previous claim no longer apply.
  resumed?: boolean
  capabilities?: {
    outputFlowControl?: {
      version: 1
      windowSu: number
    }
  }
}

export type PtyConsumerAuthentication = {
  connectionId: string
  principal: string
  authenticated: boolean
  allowSessionOwner: boolean
}

export type PtyConsumerDisplacedOwner = {
  connectionId: string
  grant: Readonly<PtyConsumerSessionGrant>
}

export type PtyConsumerSessionAdmission = {
  grant: Readonly<PtyConsumerSessionGrant>
  // Why: set when this admission takes over a still-attached owner. The transport layer owns closing
  // that connection and releasing its deliveries — do it only once the new grant has been published.
  displacedOwner?: Readonly<PtyConsumerDisplacedOwner>
  commitPublication: () => void
  rollbackPublication: () => void
}

export type PtyConsumerSessionOptions = {
  serverBuildId: string
  outputFlowControl?: {
    versions: readonly number[]
    maxWindowSu: number
  }
  ownerGraceMs?: number
  now?: () => number
  createLease?: () => string
}
