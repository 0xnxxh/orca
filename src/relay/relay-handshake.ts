// Wire-level handshake helpers for the Orca relay.

import type { Socket } from 'node:net'
import {
  MessageType,
  FrameDecoder,
  encodeHandshakeFrame,
  parseHandshakeMessage,
  type DecodedFrame
} from './protocol'
import { relayLogLine } from './relay-diagnostic-log'
import {
  CURRENT_RELAY_DAEMON_COMPATIBILITY,
  negotiateRelayDaemonCompatibility,
  relayDaemonGrantSatisfiesOffer,
  type RelayDaemonCompatibilityOffer
} from '../shared/relay-daemon-compatibility'
import {
  parseTerminalAuthorityEndpointIdentity,
  sameTerminalAuthorityEndpointIdentity,
  type SshTerminalAuthorityEndpointIdentity
} from '../shared/ssh-terminal-authority-marker'

// Why: clients treat this exit code as non-retryable; other non-zero exits are transient.
export const EXIT_CODE_VERSION_MISMATCH = 42

// ── Daemon side ─────────────────────────────────────────────────────

export type DaemonHandshakeClientRole = 'relay' | 'terminal-authority'

export type DaemonHandshakeCallbacks = {
  // leftover: bytes buffered after the handshake frame; caller must feed the dispatcher before attaching the data listener or they're lost.
  onAccepted: (sock: Socket, leftover: Buffer, clientRole: DaemonHandshakeClientRole) => void
  launchVersion: string
  endpointCredential?: string
  compatibility?: RelayDaemonCompatibilityOffer
  authorityIdentity?: SshTerminalAuthorityEndpointIdentity
}

// Why: read one handshake frame before attaching the dispatcher; version mismatch closes the socket so the bridge exits 42.
export function setupDaemonHandshake(sock: Socket, cb: DaemonHandshakeCallbacks): void {
  let handshakeResolved = false
  const decoder: FrameDecoder = new FrameDecoder(
    (frame: DecodedFrame) => {
      if (handshakeResolved) {
        return
      }
      const clientRole = handleDaemonHandshakeFrame(
        sock,
        frame,
        cb.launchVersion,
        cb.endpointCredential,
        cb.authorityIdentity ? (cb.compatibility ?? CURRENT_RELAY_DAEMON_COMPATIBILITY) : undefined,
        cb.authorityIdentity
      )
      if (clientRole) {
        handshakeResolved = true
        const leftover = decoder.drain()
        detachHandshakeListener(sock)
        cb.onAccepted(sock, leftover, clientRole)
      }
    },
    (err) => {
      process.stderr.write(`[relay] Handshake decode error: ${err.message}\n`)
      sock.destroy()
    }
  )

  const onHandshakeData = (chunk: Buffer): void => {
    decoder.feed(chunk)
  }
  sock.on('data', onHandshakeData)
  ;(sock as Socket & { __orcaOnHandshake?: typeof onHandshakeData }).__orcaOnHandshake =
    onHandshakeData
}

export function detachHandshakeListener(sock: Socket): void {
  const tagged = sock as Socket & { __orcaOnHandshake?: (chunk: Buffer) => void }
  if (tagged.__orcaOnHandshake) {
    sock.removeListener('data', tagged.__orcaOnHandshake)
    delete tagged.__orcaOnHandshake
  }
}

function handleDaemonHandshakeFrame(
  sock: Socket,
  frame: DecodedFrame,
  launchVersion: string,
  endpointCredential: string | undefined,
  authorityCompatibility: RelayDaemonCompatibilityOffer | undefined,
  serverAuthorityIdentity: SshTerminalAuthorityEndpointIdentity | undefined
): DaemonHandshakeClientRole | null {
  if (frame.type !== MessageType.Handshake) {
    process.stderr.write(
      `[relay] Protocol violation pre-handshake: type=${frame.type}; closing socket\n`
    )
    sock.destroy()
    return null
  }
  let msg: ReturnType<typeof parseHandshakeMessage>
  try {
    msg = parseHandshakeMessage(frame.payload)
  } catch (err) {
    relayLogLine(`[relay] Could not parse handshake: ${(err as Error).message}; closing socket`)
    sock.destroy()
    return null
  }
  if (msg.type !== 'orca-relay-handshake') {
    relayLogLine(`[relay] Unexpected handshake type from client: ${msg.type}; closing socket`)
    sock.destroy()
    return null
  }
  const authorityEndpoint = serverAuthorityIdentity !== undefined
  const compatibility = authorityCompatibility
    ? negotiateRelayDaemonCompatibility(authorityCompatibility, msg.compatibility)
    : null
  const versionMatches = msg.version === launchVersion
  if (
    (!versionMatches && !compatibility) ||
    (authorityEndpoint && (!endpointCredential || !compatibility))
  ) {
    relayLogLine(
      `[relay] Handshake mismatch: own=${launchVersion}, client=${msg.version}, compatible=${Boolean(compatibility)}; closing socket`
    )
    try {
      sock.write(
        encodeHandshakeFrame({
          type: 'orca-relay-handshake-mismatch',
          expected: launchVersion,
          got: msg.version,
          reason: versionMatches ? 'protocol' : 'build'
        })
      )
    } catch {
      /* best-effort — close+exit-42 still wins */
    }
    sock.end()
    return null
  }
  if (
    endpointCredential !== undefined &&
    ('endpointCredential' in msg ? msg.endpointCredential : undefined) !== endpointCredential
  ) {
    relayLogLine('[relay] Endpoint credential mismatch; closing socket')
    sock.destroy()
    return null
  }
  const authorityExpectation =
    msg.authorityExpectation === undefined
      ? null
      : parseTerminalAuthorityEndpointIdentity(msg.authorityExpectation)
  const authorityMatches = serverAuthorityIdentity
    ? Boolean(
        authorityExpectation &&
        sameTerminalAuthorityEndpointIdentity(serverAuthorityIdentity, authorityExpectation)
      )
    : msg.authorityExpectation === undefined
  if (!authorityMatches) {
    relayLogLine('[relay] Terminal authority endpoint identity mismatch; closing socket')
    try {
      sock.write(
        encodeHandshakeFrame({
          type: 'orca-relay-handshake-mismatch',
          expected: launchVersion,
          got: msg.version,
          reason: 'authority'
        })
      )
    } catch {
      /* best-effort */
    }
    sock.end()
    return null
  }
  process.stderr.write(
    `[relay] Handshake OK from version=${msg.version}, protocol=${compatibility ? `${compatibility.major}.${compatibility.minor}` : 'legacy-exact'}\n`
  )
  sock.write(
    encodeHandshakeFrame({
      type: 'orca-relay-handshake-ok',
      version: launchVersion,
      ...(compatibility ? { compatibility } : {}),
      ...(serverAuthorityIdentity ? { authorityIdentity: serverAuthorityIdentity } : {})
    })
  )
  return authorityEndpoint ? 'terminal-authority' : 'relay'
}

// ── --connect side ──────────────────────────────────────────────────

export type ConnectHandshakeCallbacks = {
  // leftover: bytes buffered after handshake-ok; caller must forward to stdout before attaching the bridge or they're dropped.
  onAccepted: (leftover: Buffer) => void
}

// Why: defense-in-depth prevents a bad .version from pairing incompatible bridge and daemon versions.
export function runConnectHandshake(
  sock: Socket,
  myVersion: string,
  cb: ConnectHandshakeCallbacks,
  endpointCredential?: string,
  authorityExpectation?: SshTerminalAuthorityEndpointIdentity
): void {
  let handshakeDone = false

  const decoder: FrameDecoder = new FrameDecoder(
    (frame: DecodedFrame) => {
      if (handshakeDone) {
        return
      }
      if (frame.type !== MessageType.Handshake) {
        process.stderr.write(
          `[relay-connect] Protocol violation: expected Handshake frame, got type=${frame.type}\n`
        )
        sock.destroy()
        process.exit(1)
      }
      let msg: ReturnType<typeof parseHandshakeMessage>
      try {
        msg = parseHandshakeMessage(frame.payload)
      } catch (err) {
        process.stderr.write(
          `[relay-connect] Could not parse handshake reply: ${(err as Error).message}\n`
        )
        sock.destroy()
        process.exit(1)
      }
      if (msg.type === 'orca-relay-handshake-ok') {
        const compatibleAuthority = Boolean(
          authorityExpectation &&
          msg.compatibility !== undefined &&
          relayDaemonGrantSatisfiesOffer(msg.compatibility, CURRENT_RELAY_DAEMON_COMPATIBILITY)
        )
        if (
          (authorityExpectation && msg.compatibility === undefined) ||
          (msg.compatibility !== undefined &&
            !relayDaemonGrantSatisfiesOffer(msg.compatibility, CURRENT_RELAY_DAEMON_COMPATIBILITY))
        ) {
          process.stderr.write('[relay-connect] Daemon returned an incompatible protocol grant\n')
          sock.destroy()
          process.exit(1)
        }
        if (msg.version !== myVersion && !compatibleAuthority) {
          process.stderr.write('[relay-connect] Daemon accepted a different build\n')
          sock.destroy()
          process.exit(1)
        }
        const authorityIdentity =
          msg.authorityIdentity === undefined
            ? null
            : parseTerminalAuthorityEndpointIdentity(msg.authorityIdentity)
        const authorityMatches = authorityExpectation
          ? Boolean(
              authorityIdentity &&
              sameTerminalAuthorityEndpointIdentity(authorityExpectation, authorityIdentity)
            )
          : msg.authorityIdentity === undefined
        if (!authorityMatches) {
          process.stderr.write('[relay-connect] Daemon returned a different authority identity\n')
          sock.destroy()
          process.exit(1)
        }
        process.stderr.write(`[relay-connect] Handshake OK at version=${msg.version}\n`)
        handshakeDone = true
        const leftover = decoder.drain()
        sock.removeAllListeners('data')
        cb.onAccepted(leftover)
        return
      }
      if (msg.type === 'orca-relay-handshake-mismatch') {
        // Why: exit inside the write callback; stderr is async on pipe transports, so exiting early drops the version detail.
        process.stderr.write(
          `[relay-connect] Handshake mismatch: expected=${msg.expected}, daemon=${msg.got}; exiting ${EXIT_CODE_VERSION_MISMATCH}\n`,
          () => {
            sock.destroy()
            process.exit(EXIT_CODE_VERSION_MISMATCH)
          }
        )
        return
      }
      process.stderr.write(`[relay-connect] Unexpected handshake type: ${msg.type}\n`)
      sock.destroy()
      process.exit(1)
    },
    (err) => {
      process.stderr.write(`[relay-connect] Handshake decode error: ${err.message}\n`)
      sock.destroy()
      process.exit(1)
    }
  )

  sock.on('data', (chunk: Buffer) => {
    if (!handshakeDone) {
      decoder.feed(chunk)
    }
  })

  sock.write(
    encodeHandshakeFrame({
      type: 'orca-relay-handshake',
      version: myVersion,
      ...(endpointCredential ? { endpointCredential } : {}),
      compatibility: CURRENT_RELAY_DAEMON_COMPATIBILITY,
      ...(authorityExpectation ? { authorityExpectation } : {})
    })
  )
}
