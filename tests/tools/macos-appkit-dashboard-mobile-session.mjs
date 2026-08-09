import { createHash, hkdfSync, randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import WebSocket from 'ws'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const FRAME_HEADER_LENGTH = 42
const FRAME_NONCE_LENGTH = 24
const SALT_LABEL = textEncoder.encode('orca-mobile-e2ee/v2/salt\0')
const INFO_LABEL = textEncoder.encode('orca-mobile-e2ee/v2/session\0')
const TRANSCRIPT_DOMAIN = 'orca-mobile-e2ee/v2/transcript'

function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function uint32(value) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function writeUint64(target, offset, value) {
  let remaining = value
  for (let index = 7; index >= 0; index--) {
    target[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}

function encodeStringList(values) {
  return concatBytes([
    uint32(values.length),
    ...values.map((value) => {
      const bytes = textEncoder.encode(value)
      return concatBytes([uint32(bytes.length), bytes])
    })
  ])
}

function encodeNumberList(values) {
  return concatBytes([uint32(values.length), ...values.map(uint32)])
}

function encodeTranscript(hello, ready) {
  const fields = [
    ['domain', textEncoder.encode(TRANSCRIPT_DOMAIN)],
    ['mobile-to-desktop.type', textEncoder.encode(hello.type)],
    ['mobile-to-desktop.version', uint32(hello.v)],
    ['mobile-to-desktop.client-public-key', Buffer.from(hello.clientPublicKeyB64, 'base64')],
    ['mobile-to-desktop.client-nonce', Buffer.from(hello.clientNonceB64, 'base64')],
    ['mobile-to-desktop.capabilities.framing', encodeNumberList(hello.capabilities.framing)],
    [
      'mobile-to-desktop.capabilities.payload-kinds',
      encodeStringList(hello.capabilities.payloadKinds)
    ],
    ['mobile-to-desktop.context.protocol', textEncoder.encode(hello.context.protocol)],
    ['mobile-to-desktop.context.initiator', textEncoder.encode(hello.context.initiator)],
    ['mobile-to-desktop.context.responder', textEncoder.encode(hello.context.responder)],
    ['mobile-to-desktop.context.transport', textEncoder.encode(hello.context.transport)],
    ['mobile-to-desktop.context.relay-host-id', textEncoder.encode('')],
    ['desktop-to-mobile.type', textEncoder.encode(ready.type)],
    ['desktop-to-mobile.version', uint32(ready.v)],
    ['desktop-to-mobile.desktop-public-key', Buffer.from(ready.desktopPublicKeyB64, 'base64')],
    ['desktop-to-mobile.client-nonce-echo', Buffer.from(ready.clientNonceB64, 'base64')],
    ['desktop-to-mobile.desktop-nonce', Buffer.from(ready.desktopNonceB64, 'base64')],
    ['desktop-to-mobile.selection.framing', uint32(ready.selection.framing)],
    ['desktop-to-mobile.selection.payload-kinds', encodeStringList(ready.selection.payloadKinds)],
    ['desktop-to-mobile.context.protocol', textEncoder.encode(ready.context.protocol)],
    ['desktop-to-mobile.context.initiator', textEncoder.encode(ready.context.initiator)],
    ['desktop-to-mobile.context.responder', textEncoder.encode(ready.context.responder)],
    ['desktop-to-mobile.context.transport', textEncoder.encode(ready.context.transport)],
    ['desktop-to-mobile.context.relay-host-id', textEncoder.encode('')]
  ]
  return concatBytes(
    fields.map(([name, value]) => {
      const nameBytes = textEncoder.encode(name)
      return concatBytes([uint32(nameBytes.length), nameBytes, uint32(value.length), value])
    })
  )
}

function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest())
}

function deriveSchedule(sharedSecret, transcript, clientNonce, desktopNonce) {
  const transcriptHash = sha256(transcript)
  const salt = sha256(concatBytes([SALT_LABEL, clientNonce, desktopNonce]))
  const info = concatBytes([INFO_LABEL, transcriptHash])
  const expanded = new Uint8Array(hkdfSync('sha256', sharedSecret, salt, info, 96))
  return {
    mobileToDesktopKey: expanded.slice(0, 32),
    desktopToMobileKey: expanded.slice(32, 64),
    sessionId: expanded.slice(64, 96),
    transcriptHash
  }
}

function frameMetadata(sessionId, direction, counter) {
  const directionByte = direction === 'mobile-to-desktop' ? 0 : 1
  const header = new Uint8Array(FRAME_HEADER_LENGTH)
  header.set(sessionId)
  header[32] = directionByte
  header[33] = 0
  writeUint64(header, 34, counter)
  const nonce = new Uint8Array(FRAME_NONCE_LENGTH)
  nonce.set(sessionId.subarray(0, 12))
  nonce[12] = 2
  nonce[13] = directionByte
  nonce[14] = 0
  writeUint64(nonce, 16, counter)
  return { header, nonce }
}

function sealText(plaintext, key, sessionId, direction, counter) {
  const { header, nonce } = frameMetadata(sessionId, direction, counter)
  const ciphertext = nacl.secretbox(
    concatBytes([header, textEncoder.encode(plaintext)]),
    nonce,
    key
  )
  return Buffer.from(concatBytes([nonce, ciphertext])).toString('base64')
}

function openText(frameB64, key, sessionId, direction, counter) {
  const frame = Buffer.from(frameB64, 'base64')
  const { header, nonce } = frameMetadata(sessionId, direction, counter)
  if (!Buffer.from(frame.subarray(0, FRAME_NONCE_LENGTH)).equals(Buffer.from(nonce))) {
    return null
  }
  const plaintext = nacl.secretbox.open(frame.subarray(FRAME_NONCE_LENGTH), nonce, key)
  if (
    !plaintext ||
    !Buffer.from(plaintext.subarray(0, FRAME_HEADER_LENGTH)).equals(Buffer.from(header))
  ) {
    return null
  }
  return textDecoder.decode(plaintext.subarray(FRAME_HEADER_LENGTH))
}

export function decodePairingUrl(pairingUrl) {
  const code = new URL(pairingUrl).searchParams.get('code')
  if (!code) {
    throw new Error('Pairing URL has no code')
  }
  return JSON.parse(Buffer.from(code.replaceAll('-', '+').replaceAll('_', '/'), 'base64'))
}

export class MobileHomeSession {
  constructor(pairingUrl, log) {
    this.pairing = decodePairingUrl(pairingUrl)
    this.log = log
    this.pending = new Map()
    this.subscriptions = new Set()
    this.nextRequestId = 0
    this.inboundCounter = 0n
    this.outboundCounter = 0n
    this.authenticated = false
    this.lastInboundAt = 0
  }

  async connect() {
    const keyPair = nacl.box.keyPair()
    const clientNonce = randomBytes(32)
    this.hello = {
      type: 'e2ee_hello',
      v: 2,
      clientPublicKeyB64: Buffer.from(keyPair.publicKey).toString('base64'),
      clientNonceB64: clientNonce.toString('base64'),
      capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
      context: {
        protocol: 'orca-mobile-e2ee',
        initiator: 'mobile',
        responder: 'desktop',
        transport: 'direct'
      }
    }
    this.clientNonce = clientNonce
    this.keyPair = keyPair
    this.socket = new WebSocket(this.pairing.endpoint)
    this.socket.on('message', (raw, binary) => this.handleMessage(raw, binary))
    this.socket.on('close', (code, reason) => this.handleClose(code, reason))
    this.socket.on('error', (error) => this.log('mobile_socket_error', { error: error.message }))
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mobile socket open timed out')), 10_000)
      this.socket.once('open', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    this.socket.send(JSON.stringify(this.hello))
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mobile authentication timed out')), 10_000)
      this.onAuthenticated = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
    this.log('mobile_connected', { endpoint: this.pairing.endpoint, protocol: 'e2ee-v2' })
  }

  async startHomeTraffic() {
    this.subscribe('notifications.subscribe', {})
    this.subscribe('accounts.subscribe', null)
    const requests = [
      ['status.get'],
      ['stats.summary'],
      ['worktree.ps', { limit: 10_000 }],
      ['accounts.list'],
      ['settings.get'],
      ['preflight.check'],
      ['linear.status']
    ]
    void Promise.allSettled(requests.map(([method, params]) => this.request(method, params)))
    this.probeTimer = setInterval(() => void this.runActivityProbe(), 20_000)
  }

  request(method, params, timeoutMs = 30_000) {
    const id = this.send(method, params)
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        this.log('mobile_request_timeout', { method, timeoutMs })
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (response) => {
          clearTimeout(timeout)
          this.log('mobile_request_complete', {
            method,
            ok: response.ok === true,
            durationMs: Date.now() - startedAt
          })
          resolve(response)
        }
      })
    })
  }

  subscribe(method, params) {
    const id = this.send(method, params)
    this.subscriptions.add(id)
    this.log('mobile_subscription_started', { method, id })
  }

  send(method, params) {
    if (!this.authenticated) {
      throw new Error(`Cannot send ${method} before mobile authentication`)
    }
    const id = `home-repro-${++this.nextRequestId}`
    const payload = { id, deviceToken: this.pairing.deviceToken, method }
    if (params !== undefined) {
      payload.params = params
    }
    this.sendEncrypted(payload)
    return id
  }

  sendEncrypted(payload) {
    const frame = sealText(
      JSON.stringify(payload),
      this.schedule.mobileToDesktopKey,
      this.schedule.sessionId,
      'mobile-to-desktop',
      this.outboundCounter++
    )
    this.socket.send(frame)
  }

  handleMessage(raw, binary) {
    try {
      if (!this.schedule) {
        if (binary) {
          throw new Error('Expected plaintext E2EE ready')
        }
        const ready = JSON.parse(raw.toString())
        this.acceptReady(ready)
        return
      }
      if (binary) {
        return
      }
      const plaintext = openText(
        raw.toString(),
        this.schedule.desktopToMobileKey,
        this.schedule.sessionId,
        'desktop-to-mobile',
        this.inboundCounter
      )
      if (!plaintext) {
        throw new Error(`Invalid mobile frame at counter ${this.inboundCounter}`)
      }
      this.inboundCounter++
      this.lastInboundAt = Date.now()
      const message = JSON.parse(plaintext)
      if (!this.authenticated) {
        if (
          message.type !== 'e2ee_authenticated' ||
          message.v !== 2 ||
          message.transcriptHashB64 !== this.transcriptHashB64
        ) {
          throw new Error('Mobile authentication rejected')
        }
        this.authenticated = true
        this.onAuthenticated?.()
        return
      }
      const pending = this.pending.get(message.id)
      if (pending) {
        this.pending.delete(message.id)
        pending.resolve(message)
      }
    } catch (error) {
      this.log('mobile_protocol_error', { error: String(error) })
    }
  }

  acceptReady(ready) {
    if (
      ready.type !== 'e2ee_ready' ||
      ready.v !== 2 ||
      ready.clientNonceB64 !== this.hello.clientNonceB64 ||
      ready.desktopPublicKeyB64 !== this.pairing.publicKeyB64 ||
      ready.context?.transport !== 'direct'
    ) {
      throw new Error('Invalid E2EE ready')
    }
    const desktopPublicKey = Buffer.from(ready.desktopPublicKeyB64, 'base64')
    const sharedSecret = nacl.box.before(desktopPublicKey, this.keyPair.secretKey)
    this.schedule = deriveSchedule(
      sharedSecret,
      encodeTranscript(this.hello, ready),
      this.clientNonce,
      Buffer.from(ready.desktopNonceB64, 'base64')
    )
    this.transcriptHashB64 = Buffer.from(this.schedule.transcriptHash).toString('base64')
    this.sendEncrypted({
      type: 'e2ee_auth',
      v: 2,
      transcriptHashB64: this.transcriptHashB64,
      deviceToken: this.pairing.deviceToken
    })
  }

  async runActivityProbe() {
    if (!this.authenticated || this.probeInFlight) {
      return
    }
    this.probeInFlight = true
    const inboundAtStart = this.lastInboundAt
    try {
      await this.request('status.get', null, 8_000)
    } catch {
      if (this.lastInboundAt <= inboundAtStart) {
        this.log('mobile_activity_probe_disconnected', {})
        this.socket.terminate()
      }
    } finally {
      this.probeInFlight = false
    }
  }

  handleClose(code, reason) {
    this.authenticated = false
    this.log('mobile_disconnected', { code, reason: reason.toString() })
    for (const pending of this.pending.values()) {
      pending.resolve({ ok: false, error: { code: 'socket_closed' } })
    }
    this.pending.clear()
  }

  close() {
    clearInterval(this.probeTimer)
    this.socket?.close()
  }
}
