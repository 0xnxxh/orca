import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { E2EEChannel } from '../../src/main/runtime/rpc/e2ee-channel'
import { generateKeyPair } from '../../src/main/runtime/rpc/e2ee-crypto'
import { MobileHomeSession } from './macos-appkit-dashboard-mobile-session.mjs'

const token = 'mobile-home-repro-token'
const resources = []

function pairingUrl(endpoint, publicKeyB64) {
  const offer = {
    v: 1,
    endpoint,
    deviceToken: token,
    publicKeyB64,
    scope: 'mobile'
  }
  const code = Buffer.from(JSON.stringify(offer), 'utf8').toString('base64url')
  return `orca://pair?code=${code}`
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for mobile Home traffic')
}

afterEach(async () => {
  for (const resource of resources.splice(0).toReversed()) {
    await resource()
  }
})

describe('macOS AppKit dashboard mobile session', () => {
  it('authenticates with E2EE v2 and sends the Home-screen request pattern', async () => {
    const serverKeys = generateKeyPair()
    const methods = []
    const channels = []
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise((resolve) => server.once('listening', resolve))
    resources.push(
      () =>
        new Promise((resolve) => {
          for (const channel of channels) {
            channel.destroy()
          }
          server.close(resolve)
        })
    )
    server.on('connection', (ws) => {
      const channel = new E2EEChannel(ws, {
        serverSecretKey: serverKeys.secretKey,
        resolveAuthenticatedDevice: (candidate) =>
          candidate === token
            ? { deviceId: 'mobile-home', deviceToken: token, scope: 'mobile' }
            : null,
        transportContext: { transport: 'direct' },
        onReady: () => {},
        onError: (code, reason) => ws.close(code, reason)
      })
      channels.push(channel)
      channel.onMessage((plaintext, reply) => {
        const request = JSON.parse(plaintext)
        methods.push(request.method)
        reply(JSON.stringify({ id: request.id, ok: true, result: {} }))
      })
      ws.on('message', (raw, isBinary) => {
        channel.handleRawMessage(isBinary ? new Uint8Array(raw) : raw.toString())
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('WebSocket test server has no TCP address')
    }
    const session = new MobileHomeSession(
      pairingUrl(
        `ws://127.0.0.1:${address.port}`,
        Buffer.from(serverKeys.publicKey).toString('base64')
      ),
      () => {}
    )
    resources.push(async () => session.close())

    await session.connect()
    await session.startHomeTraffic()
    await waitFor(() => methods.length >= 9)

    expect(methods).toEqual(
      expect.arrayContaining([
        'notifications.subscribe',
        'accounts.subscribe',
        'status.get',
        'stats.summary',
        'worktree.ps',
        'accounts.list',
        'settings.get',
        'preflight.check',
        'linear.status'
      ])
    )
  })
})
