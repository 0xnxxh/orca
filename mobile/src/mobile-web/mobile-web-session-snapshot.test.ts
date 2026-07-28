import { describe, expect, it } from 'vitest'
import { MOBILE_WEB_SESSION_TAB_LIMIT } from '../../../src/shared/mobile-web/bridge-operation-contract'
import { mobileWebSessionSnapshot } from './mobile-web-session-snapshot'
import { MobileWebBrowserAuthority } from './mobile-web-browser-authority'
import { MobileWebNativeChatAuthority } from './mobile-web-native-chat-authority'

function authorities() {
  return {
    browser: new MobileWebBrowserAuthority((length) => new Uint8Array(length)),
    nativeChat: new MobileWebNativeChatAuthority((length) => new Uint8Array(length))
  }
}

describe('mobile web session snapshot', () => {
  it('bounds tabs and strips host-only fields', () => {
    const tabs = Array.from({ length: MOBILE_WEB_SESSION_TAB_LIMIT + 1 }, (_, index) => ({
      type: index === 0 ? 'terminal' : 'file',
      id: `tab-${index}`,
      title: `Tab ${index}`,
      status: 'ready',
      terminal: 'host-terminal-handle',
      filePath: '/private/path',
      relativePath: index === 1 ? 'src/app.ts' : '../private/path',
      language: index === 1 ? 'typescript' : 'invalid language',
      mode: 'edit',
      diffSource: 'unstaged',
      url: 'https://example.invalid/secret',
      isActive: index === 0
    }))

    const authority = authorities()
    const snapshot = mobileWebSessionSnapshot(
      {
        worktree: 'workspace-1',
        publicationEpoch: 'epoch-1',
        snapshotVersion: 3,
        activeTabId: 'tab-0',
        activeTabType: 'terminal',
        tabs
      },
      'workspace-1',
      'opaque-workspace',
      authority.browser,
      authority.nativeChat
    )

    expect(snapshot.tabs).toHaveLength(MOBILE_WEB_SESSION_TAB_LIMIT)
    expect(snapshot.workspaceTransportState).toBe('available')
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.tabs[0]).toEqual({
      type: 'terminal',
      id: 'tab-0',
      title: 'Tab 0',
      status: 'ready',
      isActive: true
    })
    expect(snapshot.tabs[1]).toEqual({
      type: 'file',
      id: 'tab-1',
      title: 'Tab 1',
      relativePath: 'src/app.ts',
      language: 'typescript',
      mode: 'edit',
      diffSource: 'unstaged',
      isActive: false
    })
    expect(JSON.stringify(snapshot)).not.toContain('/private/path')
    expect(snapshot.tabs[2]).not.toHaveProperty('relativePath')
  })

  it('rejects a response for a different workspace', () => {
    const authority = authorities()
    expect(() =>
      mobileWebSessionSnapshot(
        {
          worktree: 'workspace-2',
          publicationEpoch: 'epoch-1',
          snapshotVersion: 1,
          activeTabId: null,
          activeTabType: null,
          tabs: []
        },
        'workspace-1',
        'opaque-workspace',
        authority.browser,
        authority.nativeChat
      )
    ).toThrow('mobile_web_session_snapshot_invalid')
  })

  it('projects only bounded chat state and hides host transcript authority', () => {
    const authority = authorities()
    const snapshot = mobileWebSessionSnapshot(
      {
        worktree: 'workspace-1',
        publicationEpoch: 'epoch-1',
        snapshotVersion: 4,
        workspaceTransportState: 'unavailable',
        activeTabId: 'tab-0',
        activeTabType: 'terminal',
        tabs: [
          {
            type: 'terminal',
            id: 'tab-0',
            title: 'Claude',
            status: 'ready',
            terminal: 'host-terminal-secret',
            launchAgent: 'claude',
            isActive: true,
            agentStatus: {
              state: 'waiting',
              stateStartedAt: 1_720_000_000_000,
              agentType: 'claude',
              paneKey: 'private-pane',
              terminalHandle: 'private-terminal',
              worktreeId: 'private-worktree',
              connectionId: 'private-connection',
              orchestration: { taskId: 'private-task', dispatchId: 'private-dispatch' },
              stateHistory: [{ state: 'working', prompt: 'private-history', startedAt: 1 }],
              toolName: 'AskUserQuestion',
              toolInput: 'safe preview',
              interactivePrompt: '{"question":"Continue?"}',
              lastAssistantMessage: 'Waiting for an answer',
              interrupted: false,
              providerSession: {
                id: 'provider-session-secret',
                key: 'session_id',
                transcriptPath: '/private/transcript.jsonl'
              }
            }
          }
        ]
      },
      'workspace-1',
      'opaque-workspace',
      authority.browser,
      authority.nativeChat
    )

    expect(snapshot.tabs[0]).toEqual({
      type: 'terminal',
      id: 'tab-0',
      title: 'Claude',
      status: 'ready',
      launchAgent: 'claude',
      isActive: true,
      nativeChatSessionId: expect.stringMatching(/^native_chat_0_[a-f0-9]{32}$/),
      agentStatus: {
        state: 'waiting',
        stateStartedAt: 1_720_000_000_000,
        agentType: 'claude',
        toolName: 'AskUserQuestion',
        toolInput: 'safe preview',
        interactivePrompt: '{"question":"Continue?"}',
        lastAssistantMessage: 'Waiting for an answer',
        interrupted: false
      }
    })
    expect(snapshot.workspaceTransportState).toBe('unavailable')
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('host-terminal-secret')
    expect(serialized).not.toContain('provider-session-secret')
    expect(serialized).not.toContain('/private/transcript')
    expect(serialized).not.toContain('private-pane')
    expect(serialized).not.toContain('private-worktree')
    expect(serialized).not.toContain('private-connection')
    expect(serialized).not.toContain('private-task')
  })

  it('drops malformed or oversized agent fields instead of forwarding them', () => {
    const authority = authorities()
    const snapshot = mobileWebSessionSnapshot(
      {
        worktree: 'workspace-1',
        publicationEpoch: 'epoch-1',
        snapshotVersion: 5,
        activeTabId: 'tab-0',
        activeTabType: 'terminal',
        tabs: [
          {
            type: 'terminal',
            id: 'tab-0',
            title: 'Agent',
            status: 'ready',
            terminal: 'host-terminal',
            isActive: true,
            agentStatus: {
              state: 'waiting',
              agentType: 'a'.repeat(41),
              toolName: 't'.repeat(61),
              toolInput: 'i'.repeat(161),
              interactivePrompt: 'p'.repeat(16_001),
              lastAssistantMessage: 'm'.repeat(8_001),
              providerSession: { id: 'provider-session', key: 'session_id' }
            }
          }
        ]
      },
      'workspace-1',
      'opaque-workspace',
      authority.browser,
      authority.nativeChat
    )

    expect(snapshot.tabs[0]).toEqual({
      type: 'terminal',
      id: 'tab-0',
      title: 'Agent',
      status: 'ready',
      isActive: true,
      agentStatus: { state: 'waiting' }
    })
  })
})
