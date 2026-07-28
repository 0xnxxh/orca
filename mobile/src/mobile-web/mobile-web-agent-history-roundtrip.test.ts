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

it('round trips opaque agent history and gesture-gates resume through the production bridge', async () => {
  let broker: MobileWebCapabilityBroker
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'status.get') {
      return {
        ok: true,
        result: { capabilities: ['aiVault.v1'], hostPlatform: 'darwin' }
      }
    }
    if (method === 'worktree.ps') {
      return { ok: true, result: { worktrees: [worktree()] } }
    }
    if (method === 'aiVault.listSessions') {
      return {
        ok: true,
        result: { sessions: [hostSession()], issues: [] }
      }
    }
    throw new Error(`unexpected method ${method}`)
  })
  const rpcClient = { sendRequest } as unknown as RpcClient
  const requestIds = ['A', 'B', 'C']
  let requestIndex = 0
  const client = new MobileWebBridgeClient({
    context: CONTEXT,
    grants: [
      agentHistoryGrant('snapshot'),
      agentHistoryGrant('preview'),
      agentHistoryGrant('resume')
    ],
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
      consumeRecentUserGesture: () => false
    },
    terminalClientId: 'device-token',
    randomBytes: (length) => new Uint8Array(length).fill(5)
  })
  const route = await broker.resolveNavigationRoute('host-workspace')
  if (route.kind !== 'session') {
    throw new Error('expected session route')
  }

  const snapshot = await client.agentHistory.snapshot({
    workspaceId: route.workspaceId,
    scope: 'workspace',
    query: '',
    force: false
  })
  expect(snapshot.sessions).toHaveLength(1)
  const row = snapshot.sessions[0]!
  expect(row).toMatchObject({
    title: 'Private session',
    agent: 'codex',
    groupLabel: 'ada/mobile-rearch'
  })
  expect(JSON.stringify(row)).not.toContain('/Users/ada')
  expect(JSON.stringify(row)).not.toContain('provider-secret')

  await expect(client.agentHistory.preview(row.handle)).resolves.toEqual({
    messages: [{ role: 'assistant', text: 'safe preview' }]
  })
  await expect(
    client.agentHistory.resume({
      workspaceId: route.workspaceId,
      sessionHandle: row.handle
    })
  ).rejects.toMatchObject({ code: 'permission_required' })
  expect(sendRequest).not.toHaveBeenCalledWith('repo.list', expect.anything(), expect.anything())
})

function agentHistoryGrant(operation: 'snapshot' | 'preview' | 'resume') {
  return {
    capability: 'agentHistory' as const,
    operation,
    limits: {
      maxRequestBytes: 2048,
      maxResponseBytes: 384 * 1024,
      maxConcurrent: 2,
      rateCapacity: 8,
      rateRefillPerSecond: 8
    }
  }
}

function hostSession() {
  return {
    id: 'native-session',
    executionHostId: 'local',
    agent: 'codex',
    sessionId: 'provider-secret',
    title: 'Private session',
    cwd: '/Users/ada/mobile-rearch',
    branch: 'mobile-rearch',
    model: null,
    filePath: '/Users/ada/.codex/private.jsonl',
    codexHome: '/Users/ada/.codex',
    createdAt: null,
    updatedAt: '2026-07-26T00:00:00.000Z',
    modifiedAt: '2026-07-26T00:00:00.000Z',
    messageCount: 1,
    totalTokens: 1,
    previewMessages: [{ role: 'assistant', text: 'safe preview', timestamp: null }],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'private command',
    subagent: null
  }
}

function worktree() {
  return {
    worktreeId: 'host-workspace',
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'mobile-rearch',
    displayName: 'mobile-rearch',
    path: '/Users/ada/mobile-rearch',
    liveTerminalCount: 1,
    hasAttachedPty: true,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null
  }
}
