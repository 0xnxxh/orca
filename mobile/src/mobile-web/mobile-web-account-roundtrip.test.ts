import { expect, it, vi } from 'vitest'
import {
  parseMobileWebBridgePageMessage,
  parseMobileWebBridgeShellMessage
} from '../../../src/shared/mobile-web/bridge-contract'
import { MobileWebBridgeClient } from '../../../src/mobile-web/src/mobile-web-bridge-client'
import type { RpcClient } from '../transport/rpc-client'
import { MobileWebCapabilityBroker } from './mobile-web-capability-broker'

const CONTEXT = {
  shellSessionId: 'S'.repeat(43),
  buildId: 'a'.repeat(64)
}

it('round trips typed account reads, selection, and snapshots through the production bridge', async () => {
  let broker: MobileWebCapabilityBroker
  let hostListener: ((event: unknown) => void) | null = null
  const hostUnsubscribe = vi.fn()
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'accounts.list') {
      return { ok: true, result: hostSnapshot() }
    }
    return { ok: true, result: {} }
  })
  const rpcClient = {
    sendRequest,
    subscribe: vi.fn((_method, _params, listener) => {
      hostListener = listener
      return hostUnsubscribe
    })
  } as unknown as RpcClient
  const requestIds = ['A', 'B', 'C', 'D', 'E']
  let requestIndex = 0
  const client = new MobileWebBridgeClient({
    context: CONTEXT,
    grants: [accountGrant('snapshot'), accountGrant('select'), accountGrant('subscribe')],
    createRequestId: () => requestIds[requestIndex++]!.repeat(22),
    postMessage: (message) => {
      const parsed = parseMobileWebBridgePageMessage(JSON.stringify(message), CONTEXT)
      if (!parsed.ok) {
        return false
      }
      void broker.handle(parsed.value)
      return true
    }
  })
  broker = new MobileWebCapabilityBroker({
    context: CONTEXT,
    getClient: () => rpcClient,
    isConnected: () => true,
    isActive: () => true,
    postMessage: (message) => {
      const parsed = parseMobileWebBridgeShellMessage(JSON.stringify(message), CONTEXT)
      if (!parsed.ok) {
        throw new Error(parsed.error)
      }
      client.receive(parsed.value)
    },
    nativeAuthority: {
      hapticFeedback: vi.fn(),
      clipboardWrite: vi.fn(),
      openExternal: vi.fn(),
      terminalPreferences: vi.fn(),
      terminalTextScaleUpdate: vi.fn()
    },
    navigationAuthority: {
      route: vi.fn(),
      reconnect: vi.fn(),
      removeHost: vi.fn(),
      consumeRecentUserGesture: () => true
    },
    terminalClientId: 'device-token',
    randomBytes: (length) => new Uint8Array(length).fill(1)
  })

  await expect(client.account.snapshot()).resolves.toMatchObject({
    claude: {
      accounts: [{ id: 'claude-1', email: 'claude@example.com' }],
      activeAccountId: 'claude-1'
    }
  })
  await expect(
    client.account.select({ provider: 'codex', accountId: 'codex-1' })
  ).resolves.toBeNull()
  expect(sendRequest).toHaveBeenCalledWith('accounts.selectCodex', {
    accountId: 'codex-1'
  })

  const onEvent = vi.fn()
  const subscription = client.account.subscribe(onEvent, vi.fn())
  await subscription.ready
  hostListener?.({ type: 'snapshot', snapshot: hostSnapshot() })
  await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'snapshot',
      snapshot: expect.objectContaining({
        codex: { accounts: [], activeAccountId: null }
      })
    })
  )
  subscription.unsubscribe()
  expect(hostUnsubscribe).toHaveBeenCalledOnce()
})

function accountGrant(operation: 'snapshot' | 'select' | 'subscribe') {
  return {
    capability: 'account' as const,
    operation,
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 96 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 8
    }
  }
}

function hostSnapshot() {
  return {
    claude: {
      accounts: [{ id: 'claude-1', email: 'claude@example.com' }],
      activeAccountId: 'claude-1'
    },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: null,
      codex: null,
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: []
    }
  }
}
