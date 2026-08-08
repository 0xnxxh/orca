// @vitest-environment happy-dom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalTab } from '../../../../shared/types'

const mocks = vi.hoisted(() => ({
  parkableTabIds: new Set<string>(),
  parkedTabIds: new Set<string>(),
  handoffCalls: [] as {
    desiredParkedTabIds: ReadonlySet<string>
    activationDeferredMountTabIds?: ReadonlySet<string> | null
  }[],
  terminalPaneProps: [] as Record<string, unknown>[]
}))

vi.mock('./terminal-parked-tab-watchers', () => ({
  canWatcherCoverParkedTerminalTab: (_worktreeId: string, tab: { id: string }) =>
    mocks.parkableTabIds.has(tab.id)
}))

vi.mock('./use-terminal-tab-park-handoff', () => ({
  useTerminalTabParkHandoff: (args: {
    desiredParkedTabIds: ReadonlySet<string>
    activationDeferredMountTabIds?: ReadonlySet<string> | null
  }) => {
    mocks.handoffCalls.push(args)
    return new Set(mocks.parkedTabIds)
  }
}))

vi.mock('./TerminalPane', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.terminalPaneProps.push({
      tabId: props.tabId,
      terminalGeneration: props.terminalGeneration,
      cwd: props.cwd
    })
    return <div data-testid={`terminal-pane-${String(props.tabId)}`} />
  }
}))

import { LegacyTerminalWorkspaceSurface } from './LegacyTerminalWorkspaceSurface'

const WORKTREE_ID = 'folder:workspace-1'

function terminalTab(id: string, generation: number): TerminalTab {
  return {
    id,
    generation,
    ptyId: `ssh:connection@@${id}`,
    worktreeId: WORKTREE_ID,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function renderSurface(args?: {
  shouldColdParkTerminalPanes?: boolean
  activationDeferredMountTabIds?: ReadonlySet<string> | null
}): React.JSX.Element {
  return (
    <LegacyTerminalWorkspaceSurface
      worktreeId={WORKTREE_ID}
      worktreePath="C:\folder workspace"
      terminalTabs={[terminalTab('tab-1', 7), terminalTab('tab-2', 11)]}
      activeTabId="tab-1"
      isVisible
      isTerminalTabTypeActive
      shouldMeasureHiddenWorktree={false}
      shouldColdParkTerminalPanes={args?.shouldColdParkTerminalPanes ?? false}
      activityTerminalPortals={[]}
      evictionExemptTerminalTabIds={new Set()}
      backgroundMountTabIds={null}
      activationDeferredMountTabIds={args?.activationDeferredMountTabIds ?? null}
      onPtyExit={vi.fn()}
      onCloseTab={vi.fn()}
    />
  )
}

describe('LegacyTerminalWorkspaceSurface', () => {
  beforeEach(() => {
    mocks.parkableTabIds.clear()
    mocks.parkedTabIds.clear()
    mocks.handoffCalls.length = 0
    mocks.terminalPaneProps.length = 0
  })

  it('keeps panes mounted until watcher preparation completes and preserves generation identity', () => {
    const view = render(renderSurface({ shouldColdParkTerminalPanes: true }))

    expect(view.getByTestId('terminal-pane-tab-1')).toBeTruthy()
    expect(mocks.handoffCalls.at(-1)?.desiredParkedTabIds).toEqual(new Set(['tab-1', 'tab-2']))
    expect(mocks.terminalPaneProps[0]).toMatchObject({
      tabId: 'tab-1',
      terminalGeneration: 7,
      cwd: 'C:\\folder workspace'
    })

    mocks.parkedTabIds = new Set(['tab-1', 'tab-2'])
    view.rerender(renderSurface({ shouldColdParkTerminalPanes: true }))
    expect(view.queryByTestId('terminal-pane-tab-1')).toBeNull()

    mocks.parkedTabIds.clear()
    view.rerender(renderSurface())
    expect(view.getByTestId('terminal-pane-tab-1')).toBeTruthy()
    expect(mocks.handoffCalls.at(-1)?.desiredParkedTabIds).toEqual(new Set())
  })

  it('defers only tabs with exact durable watcher coverage', () => {
    mocks.parkableTabIds.add('tab-2')
    const deferredTabIds = new Set(['tab-1', 'tab-2'])

    render(renderSurface({ activationDeferredMountTabIds: deferredTabIds }))

    expect(mocks.handoffCalls.at(-1)?.desiredParkedTabIds).toEqual(new Set(['tab-2']))
    expect(mocks.handoffCalls.at(-1)?.activationDeferredMountTabIds).toBe(deferredTabIds)
  })
})
