import { describe, expect, it } from 'vitest'
import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/types'
import {
  buildResourceSessionBindingIndex,
  countUnboundDaemonSessions,
  selectUnboundDaemonSessions
} from './resource-session-bindings'

function makeTab(id: string, ptyId: string | null = null): TerminalTab {
  return {
    id,
    ptyId,
    worktreeId: 'repo::/workspace',
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    type: 'terminal',
    paneCount: 1
  } as unknown as TerminalTab
}

function makeLayout(ptyIdsByLeafId: Record<string, string>): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId: 'leaf-1' },
    activeLeafId: 'leaf-1',
    expandedLeafId: null,
    ptyIdsByLeafId
  }
}

describe('resource session bindings', () => {
  it('combines live PTYs with restored tab and split-pane wake hints', () => {
    const index = buildResourceSessionBindingIndex({
      ptyIdsByTabId: {
        'tab-active': ['pty-live', 'pty-live']
      },
      tabsByWorktree: {
        'repo::/workspace': [makeTab('tab-active'), makeTab('tab-restored', 'pty-restored')]
      },
      terminalLayoutsByTabId: {
        'tab-restored': makeLayout({
          'leaf-1': 'pty-leaf-a',
          'leaf-2': 'pty-leaf-b'
        })
      },
      workspaceSessionReady: true
    })

    expect(index.ptyIdToTabId).toEqual(
      new Map([
        ['pty-live', 'tab-active'],
        ['pty-restored', 'tab-restored'],
        ['pty-leaf-a', 'tab-restored'],
        ['pty-leaf-b', 'tab-restored']
      ])
    )
    expect([...index.boundPtyIds].sort()).toEqual([
      'pty-leaf-a',
      'pty-leaf-b',
      'pty-live',
      'pty-restored'
    ])
  })

  it('ignores stale layout-only PTYs after their tab is gone', () => {
    const index = buildResourceSessionBindingIndex({
      ptyIdsByTabId: {},
      tabsByWorktree: {
        'repo::/workspace': [makeTab('tab-live', null)]
      },
      terminalLayoutsByTabId: {
        'tab-closed': makeLayout({ 'leaf-1': 'pty-closed' })
      },
      workspaceSessionReady: true
    })

    expect(index.ptyIdToTabId.has('pty-closed')).toBe(false)
    expect(index.boundPtyIds.has('pty-closed')).toBe(false)
  })

  it('counts only daemon sessions without live or restorable tab bindings', () => {
    const count = countUnboundDaemonSessions(
      [
        { id: 'pty-live', cwd: '/workspace', title: 'live', hasAgentOwner: false },
        { id: 'pty-restored', cwd: '/workspace', title: 'restored', hasAgentOwner: false },
        { id: 'pty-orphan', cwd: '/tmp', title: 'orphan', hasAgentOwner: false }
      ],
      {
        ptyIdsByTabId: { 'tab-live': ['pty-live'] },
        tabsByWorktree: {
          'repo::/workspace': [makeTab('tab-live'), makeTab('tab-restored', 'pty-restored')]
        },
        terminalLayoutsByTabId: {},
        workspaceSessionReady: true
      }
    )

    expect(count).toBe(1)
  })

  it('binds a session deferred for SSH reattach so it is never offered for cleanup', () => {
    const inputs = {
      ptyIdsByTabId: {},
      tabsByWorktree: { 'repo::/workspace': [makeTab('tab-ssh')] },
      terminalLayoutsByTabId: {},
      deferredSshSessionIdsByTabId: { 'tab-ssh': 'pty-deferred' },
      workspaceSessionReady: true
    }

    expect(buildResourceSessionBindingIndex(inputs).boundPtyIds.has('pty-deferred')).toBe(true)
    expect(
      selectUnboundDaemonSessions(
        [{ id: 'pty-deferred', cwd: '/workspace', title: 'agent', hasAgentOwner: false }],
        inputs
      )
    ).toEqual([])
  })

  it('ignores a deferred session whose tab no longer exists', () => {
    const index = buildResourceSessionBindingIndex({
      ptyIdsByTabId: {},
      tabsByWorktree: { 'repo::/workspace': [makeTab('tab-live')] },
      terminalLayoutsByTabId: {},
      deferredSshSessionIdsByTabId: { 'tab-gone': 'pty-stranded' },
      workspaceSessionReady: true
    })

    expect(index.boundPtyIds.has('pty-stranded')).toBe(false)
  })

  it('never offers an agent-owned session for cleanup even with no binding at all', () => {
    const inputs = {
      ptyIdsByTabId: {},
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      workspaceSessionReady: true
    }
    const sessions = [
      { id: 'pty-agent', cwd: '/workspace', title: 'codex', hasAgentOwner: true },
      { id: 'pty-shell', cwd: '/tmp', title: 'shell', hasAgentOwner: false }
    ]

    expect(selectUnboundDaemonSessions(sessions, inputs).map((s) => s.id)).toEqual(['pty-shell'])
    expect(countUnboundDaemonSessions(sessions, inputs)).toBe(1)
  })

  it('keeps the advertised count and the selected set identical', () => {
    const inputs = {
      ptyIdsByTabId: { 'tab-live': ['pty-live'] },
      tabsByWorktree: { 'repo::/workspace': [makeTab('tab-live'), makeTab('tab-ssh')] },
      terminalLayoutsByTabId: {},
      deferredSshSessionIdsByTabId: { 'tab-ssh': 'pty-deferred' },
      workspaceSessionReady: true
    }
    const sessions = [
      { id: 'pty-live', cwd: '/workspace', title: 'live', hasAgentOwner: false },
      { id: 'pty-deferred', cwd: '/workspace', title: 'deferred', hasAgentOwner: false },
      { id: 'pty-agent', cwd: '/workspace', title: 'codex', hasAgentOwner: true },
      { id: 'pty-orphan', cwd: '/tmp', title: 'orphan', hasAgentOwner: false }
    ]

    expect(selectUnboundDaemonSessions(sessions, inputs).map((s) => s.id)).toEqual(['pty-orphan'])
    expect(countUnboundDaemonSessions(sessions, inputs)).toBe(
      selectUnboundDaemonSessions(sessions, inputs).length
    )
  })

  it('offers nothing while the workspace session is still loading', () => {
    const sessions = [{ id: 'pty-any', cwd: '/tmp', title: 'shell', hasAgentOwner: false }]
    const inputs = {
      ptyIdsByTabId: {},
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      workspaceSessionReady: false
    }

    expect(selectUnboundDaemonSessions(sessions, inputs)).toEqual([])
    expect(countUnboundDaemonSessions(sessions, inputs)).toBe(0)
  })
})
