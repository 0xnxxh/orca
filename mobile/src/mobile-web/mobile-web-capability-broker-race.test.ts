import { describe, expect, it, vi } from 'vitest'
import {
  MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
  type MobileWebBridgePageMessage,
  type MobileWebBridgeShellMessage
} from '../../../src/shared/mobile-web/bridge-contract'
import type { RpcClient } from '../transport/rpc-client'
import { MobileWebCapabilityBroker } from './mobile-web-capability-broker'

const CONTEXT = {
  shellSessionId: 'S'.repeat(43),
  buildId: 'a'.repeat(64)
}
const WORKSPACE_ID = `workspace_0_${'01'.repeat(16)}`

describe('mobile web capability broker races', () => {
  it('prevents a cancelled terminal subscription from registering after host resolution', async () => {
    const harness = await createPrimedHarness()
    const tabs = deferredHostResult()
    harness.sendRequest.mockReturnValue(tabs.promise)

    const pending = harness.broker.handle(terminalSubscriptionRequest())
    await waitForTerminalResolution(harness)
    await harness.broker.handle(subscriptionCancel())
    tabs.resolve(terminalTabsResult())
    await pending

    expect(harness.subscribe).not.toHaveBeenCalled()
    expect(responseFor(harness.messages, 'T')).toEqual([])
  })

  it('prevents client replacement from reviving a pending terminal subscription', async () => {
    const harness = await createPrimedHarness()
    const tabs = deferredHostResult()
    harness.sendRequest.mockReturnValue(tabs.promise)

    const pending = harness.broker.handle(terminalSubscriptionRequest())
    await waitForTerminalResolution(harness)
    harness.broker.replaceClient(null)
    tabs.resolve(terminalTabsResult())
    await pending

    expect(harness.subscribe).not.toHaveBeenCalled()
    expect(responseFor(harness.messages, 'T')).toEqual([
      expect.objectContaining({
        status: 'error',
        error: { code: 'cancelled', retryable: false }
      })
    ])
  })

  it('prevents disposal from recreating host resources after terminal resolution', async () => {
    const harness = await createPrimedHarness()
    const tabs = deferredHostResult()
    harness.sendRequest.mockReturnValue(tabs.promise)

    const pending = harness.broker.handle(terminalSubscriptionRequest())
    await waitForTerminalResolution(harness)
    harness.broker.dispose()
    tabs.resolve(terminalTabsResult())
    await pending

    expect(harness.subscribe).not.toHaveBeenCalled()
    expect(responseFor(harness.messages, 'T')).toEqual([])
  })

  it('retains request replay protection across authenticated client replacement', async () => {
    const harness = await createPrimedHarness()

    harness.broker.replaceClient(null)
    await harness.broker.handle(workspaceSnapshotRequest())

    expect(harness.sendRequest).toHaveBeenCalledOnce()
    expect(responseFor(harness.messages, 'P').at(-1)).toMatchObject({
      status: 'error',
      error: { code: 'invalid_request', retryable: false }
    })
  })
})

async function createPrimedHarness() {
  const messages: MobileWebBridgeShellMessage[] = []
  const sendRequest = vi.fn<RpcClient['sendRequest']>()
  const subscribe = vi.fn<RpcClient['subscribe']>()
  const client = {
    sendRequest,
    subscribe,
    sendTerminalBinaryFrame: vi.fn(() => true)
  } as unknown as RpcClient
  const broker = new MobileWebCapabilityBroker({
    context: CONTEXT,
    getClient: () => client,
    isConnected: () => true,
    isActive: () => true,
    postMessage: (message) => messages.push(message),
    nativeAuthority: {
      hapticFeedback: vi.fn(),
      clipboardWrite: vi.fn(),
      openExternal: vi.fn(),
      terminalPreferences: vi.fn(),
      terminalTextScaleUpdate: vi.fn()
    },
    terminalClientId: 'device-token',
    randomBytes: (length) => new Uint8Array(length).fill(1)
  })
  sendRequest.mockResolvedValueOnce({
    ok: true,
    result: { worktrees: [{ worktreeId: 'workspace-1', repoId: 'repo-1' }] }
  })
  await broker.handle(workspaceSnapshotRequest())
  return { broker, messages, sendRequest, subscribe }
}

function workspaceSnapshotRequest(): Extract<MobileWebBridgePageMessage, { type: 'request' }> {
  return {
    ...envelope(),
    type: 'request',
    mode: 'once',
    requestId: 'P'.repeat(22),
    capability: 'workspace',
    operation: 'snapshot',
    payload: { limit: 1 }
  }
}

function terminalSubscriptionRequest(): Extract<MobileWebBridgePageMessage, { type: 'request' }> {
  return {
    ...envelope(),
    type: 'request',
    mode: 'subscription',
    requestId: 'T'.repeat(22),
    subscriptionId: 'Z'.repeat(22),
    capability: 'terminal',
    operation: 'subscribe',
    payload: {
      operation: 'subscribe',
      workspaceId: WORKSPACE_ID,
      tabId: 'terminal-1',
      viewport: { cols: 80, rows: 24 },
      visible: true
    }
  }
}

function subscriptionCancel(): Extract<MobileWebBridgePageMessage, { type: 'cancel' }> {
  return {
    ...envelope(),
    type: 'cancel',
    target: 'subscription',
    id: 'Z'.repeat(22)
  }
}

function envelope() {
  return {
    version: MOBILE_WEB_BRIDGE_PROTOCOL_VERSION,
    shellSessionId: CONTEXT.shellSessionId,
    buildId: CONTEXT.buildId
  } as const
}

function deferredHostResult() {
  let resolve = (_value: ReturnType<typeof terminalTabsResult>): void => {}
  const promise = new Promise<ReturnType<typeof terminalTabsResult>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function terminalTabsResult() {
  return {
    ok: true as const,
    result: {
      worktree: 'workspace-1',
      activeTabId: 'terminal-1',
      tabs: [
        {
          id: 'terminal-1',
          type: 'terminal',
          status: 'ready',
          terminal: 'host-terminal-secret',
          isActive: true
        }
      ]
    }
  }
}

async function waitForTerminalResolution(
  harness: Awaited<ReturnType<typeof createPrimedHarness>>
): Promise<void> {
  await vi.waitFor(() =>
    expect(harness.sendRequest).toHaveBeenCalledWith('session.tabs.list', {
      worktree: 'id:workspace-1'
    })
  )
}

function responseFor(messages: MobileWebBridgeShellMessage[], id: string) {
  return messages.filter(
    (message) => message.type === 'response' && message.requestId === id.repeat(22)
  )
}
