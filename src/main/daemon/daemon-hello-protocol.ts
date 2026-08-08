import { TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION } from '../../shared/terminal-session-authority-consumer-proof'
import { TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION } from '../../shared/terminal-session-authority-consumer-retirement'
import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'

export const TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY = 1 as const

export type DaemonTerminalAuthorityConsumerProofOffer = Readonly<{
  versions: readonly number[]
  retirementVersions?: readonly number[]
}>

export type DaemonTerminalAuthorityConsumerProofGrant = Readonly<{
  version: typeof TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION
  authorityHostId: string
  retirementVersion?: typeof TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
}>

export type DaemonHelloCapabilities = {
  terminalSessionAuthority?: typeof TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY
  /** Proof-only: a peer that offers none negotiates no authority and stays on the legacy path. */
  terminalAuthorityConsumerProof?:
    | DaemonTerminalAuthorityConsumerProofOffer
    | DaemonTerminalAuthorityConsumerProofGrant
}

export const CURRENT_DAEMON_HELLO_CAPABILITIES: Readonly<DaemonHelloCapabilities> = Object.freeze({
  terminalSessionAuthority: TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY,
  terminalAuthorityConsumerProof: Object.freeze({
    versions: Object.freeze([TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION]),
    retirementVersions: Object.freeze([TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION])
  })
})

export type HelloMessage = {
  type: 'hello'
  version: number
  token: string
  clientId: string
  role: 'control' | 'stream'
  capabilities?: DaemonHelloCapabilities
}

export type DaemonEndpointIdentity = {
  pid: number
  startedAtMs: number
  launchNonce: string
  /** Optional launch metadata. Absent from daemons that predate it; readers must fall back. */
  entryPath?: string
  appVersion?: string
  spawnerExecPath?: string
}

export type HelloResponse = {
  type: 'hello'
  ok: boolean
  error?: string
  daemonIdentity?: DaemonEndpointIdentity
  capabilities?: DaemonHelloCapabilities
}

export function parseDaemonHelloCapabilities(value: unknown): DaemonHelloCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  // Unknown members are dropped, not rejected: a newer peer may offer capabilities this build has no name for.
  const raw = value as {
    terminalSessionAuthority?: unknown
    terminalAuthorityConsumerProof?: unknown
  }
  const consumerProof = parseConsumerProofCapability(raw.terminalAuthorityConsumerProof)
  return {
    ...(raw.terminalSessionAuthority === TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY
      ? { terminalSessionAuthority: TERMINAL_SESSION_AUTHORITY_HELLO_CAPABILITY }
      : {}),
    ...(consumerProof ? { terminalAuthorityConsumerProof: consumerProof } : {})
  }
}

export function sameDaemonHelloCapabilities(
  left: DaemonHelloCapabilities,
  right: DaemonHelloCapabilities
): boolean {
  return (
    left.terminalSessionAuthority === right.terminalSessionAuthority &&
    sameConsumerProofCapability(
      left.terminalAuthorityConsumerProof,
      right.terminalAuthorityConsumerProof
    )
  )
}

function parseConsumerProofCapability(
  value: unknown
): DaemonTerminalAuthorityConsumerProofOffer | DaemonTerminalAuthorityConsumerProofGrant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const raw = value as {
    versions?: unknown
    retirementVersions?: unknown
    version?: unknown
    retirementVersion?: unknown
    authorityHostId?: unknown
  }
  if (
    Array.isArray(raw.versions) &&
    raw.versions.length <= 8 &&
    raw.versions.every((version) => Number.isSafeInteger(version) && Number(version) > 0)
  ) {
    const offeredRetirementVersions = Array.isArray(raw.retirementVersions)
      ? raw.retirementVersions
      : null
    const retirementVersions = offeredRetirementVersions
      ? offeredRetirementVersions.filter(
          (version) => Number.isSafeInteger(version) && Number(version) > 0
        )
      : []
    return Object.freeze({
      versions: Object.freeze(raw.versions.map(Number)),
      ...(retirementVersions.length === offeredRetirementVersions?.length &&
      retirementVersions.length > 0
        ? { retirementVersions: Object.freeze(retirementVersions.map(Number)) }
        : {})
    })
  }
  if (raw.version !== TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION) {
    return null
  }
  try {
    assertAuthorityId(raw.authorityHostId, 'authorityHostId')
  } catch {
    return null
  }
  return Object.freeze({
    version: TERMINAL_AUTHORITY_CONSUMER_PROOF_VERSION,
    authorityHostId: raw.authorityHostId,
    ...(raw.retirementVersion === TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION
      ? { retirementVersion: TERMINAL_AUTHORITY_CONSUMER_RETIREMENT_VERSION }
      : {})
  })
}

function sameConsumerProofCapability(
  left: DaemonHelloCapabilities['terminalAuthorityConsumerProof'],
  right: DaemonHelloCapabilities['terminalAuthorityConsumerProof']
): boolean {
  if (!left || !right) {
    return left === right
  }
  if ('versions' in left || 'versions' in right) {
    return (
      'versions' in left &&
      'versions' in right &&
      left.versions.length === right.versions.length &&
      left.versions.every((version, index) => version === right.versions[index]) &&
      sameOptionalVersions(left.retirementVersions, right.retirementVersions)
    )
  }
  return (
    left.version === right.version &&
    left.authorityHostId === right.authorityHostId &&
    left.retirementVersion === right.retirementVersion
  )
}

function sameOptionalVersions(left?: readonly number[], right?: readonly number[]): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.length === right.length &&
      left.every((version, index) => version === right[index])
    )
  )
}
