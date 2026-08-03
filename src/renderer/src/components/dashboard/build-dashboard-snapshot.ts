import type { AppState } from '@/store/types'
import type {
  DashboardCard,
  DashboardCardDotState,
  DashboardCardSubagent,
  DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'
import type { RepoIcon } from '../../../../shared/repo-icon'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../../shared/workspace-statuses'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  resolveDashboardCardTerminalInput,
  type DashboardCardTerminalInputState
} from './dashboard-card-terminal-input'
import { readDashboardClientHost } from './dashboard-client-host'
import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import { applyAgentRowLineage, dashboardCardParentPaneKey } from './agent-row-lineage'
import { lastEnteredDoneAt } from './agent-finished-timestamp'
import { buildWorktreeAgentRows } from '../sidebar/worktree-agent-rows'
import {
  selectLiveAgentStatusEntriesForWorktree,
  selectMigrationUnsupportedEntriesForWorktree,
  selectRetainedAgentEntriesForWorktree,
  selectRuntimeAgentOrchestrationForWorktree,
  selectTerminalLayoutsForWorktree
} from '../sidebar/worktree-agent-row-selectors'
import {
  EMPTY_WORKTREE_AGENT_ORCHESTRATION,
  releaseRuntimeAgentOrchestrationBatchCache,
  selectRuntimeAgentOrchestrationBatch
} from '../sidebar/worktree-agent-orchestration-batch'
import {
  selectLivePtyIdsForWorktree,
  selectRuntimePaneTitlesForWorktree
} from '../sidebar/worktree-card-status-inputs'
import {
  resolveDashboardCardContext,
  type DashboardCardContextState
} from './dashboard-card-context'
import {
  collectActiveDashboardWorkspaces,
  dashboardCardHostKind
} from './dashboard-snapshot-workspaces'
import {
  boundedDashboardLabel,
  boundedDashboardLabelOrUndefined,
  dashboardBucketForState,
  dashboardCardConversationName,
  dashboardCardTask,
  dashboardOptionalText
} from './dashboard-snapshot-card-fields'
import { buildDashboardWorktreeLaunchOptions } from './dashboard-worktree-launch-options'

/** The store slices the snapshot builder reads. Kept as a Pick so unit tests
 *  can pass a partial store without constructing the whole AppState. */
export type DashboardSnapshotState = Pick<
  AppState,
  | 'repos'
  | 'worktreesByRepo'
  | 'tabsByWorktree'
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
  | 'migrationUnsupportedByPtyId'
  | 'runtimeAgentOrchestrationByPaneKey'
  | 'terminalLayoutsByTabId'
  | 'ptyIdsByTabId'
  | 'runtimePaneTitlesByTabId'
  | 'acknowledgedAgentsByPaneKey'
  | 'settings'
> &
  DashboardCardContextState &
  Partial<
    DashboardCardTerminalInputState &
      Pick<AppState, 'detectedAgentIds' | 'remoteDetectedAgentIds' | 'runtimeDetectedAgentIds'>
  >

/**
 * Derive the serializable dashboard snapshot from the live renderer store.
 * Reuses the exact per-worktree row machinery the sidebar uses
 * (buildWorktreeAgentRows + the indexed selectors), then flattens every
 * worktree's rows into presentational cards. Provider subagents without their
 * own terminal stay folded into their spawning card.
 */
export function buildDashboardSnapshot(
  state: DashboardSnapshotState,
  now: number,
  options: { includeCardDetails?: boolean; includeFilterOptions?: boolean } = {}
): DashboardSnapshot {
  const cards: DashboardCard[] = []
  const clientHost = readDashboardClientHost()
  const repoIconsByRepoId: Record<string, RepoIcon | null> = {}
  const includeCardDetails = options.includeCardDetails !== false
  const generatedTitlesEnabled = state.settings?.tabAutoGenerateTitle === true
  const activeWorktrees = collectActiveDashboardWorkspaces(state)
  const filterOptions =
    options.includeFilterOptions === false
      ? undefined
      : {
          // Why: an over-long snapshot-level project label rejects the whole board.
          projects: [
            ...new Map(
              activeWorktrees.map((workspace) => [workspace.projectId, workspace])
            ).values()
          ].map((workspace) => ({
            id: workspace.projectId,
            label: boundedDashboardLabel(workspace.projectName)
          })),
          workspaceStatuses: (state.workspaceStatuses && state.workspaceStatuses.length > 0
            ? state.workspaceStatuses
            : DEFAULT_WORKSPACE_STATUSES
          ).map((status) => ({
            id: status.id,
            label: status.label,
            color: status.color
          }))
        }
  let singletonOrchestration: ReturnType<typeof selectRuntimeAgentOrchestrationForWorktree> | null =
    null
  let orchestrationByWorktree: ReturnType<typeof selectRuntimeAgentOrchestrationBatch> | null = null
  if (activeWorktrees.length >= 2) {
    orchestrationByWorktree = selectRuntimeAgentOrchestrationBatch(
      state,
      activeWorktrees.map(({ worktree }) => worktree.id)
    )
  } else {
    releaseRuntimeAgentOrchestrationBatchCache()
    if (activeWorktrees.length === 1) {
      singletonOrchestration = selectRuntimeAgentOrchestrationForWorktree(
        state,
        activeWorktrees[0].worktree.id
      )
    }
  }

  for (const workspace of activeWorktrees) {
    const { repo, worktree } = workspace
    const worktreeId = worktree.id
    const liveEntries = selectLiveAgentStatusEntriesForWorktree(state, worktreeId)
    const migrationUnsupported = selectMigrationUnsupportedEntriesForWorktree(state, worktreeId)
    const entries =
      migrationUnsupported.length > 0
        ? [
            ...liveEntries,
            ...migrationUnsupported.flatMap((unsupported) => {
              const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
              return entry ? [entry] : []
            })
          ]
        : liveEntries
    const terminalLayoutsByTabId = selectTerminalLayoutsForWorktree(state, worktreeId)

    const rows = applyAgentRowLineage(
      buildWorktreeAgentRows({
        tabs: state.tabsByWorktree[worktreeId] ?? [],
        entries,
        retained: selectRetainedAgentEntriesForWorktree(state, worktreeId),
        runtimePaneTitlesByTabId: selectRuntimePaneTitlesForWorktree(state, worktreeId),
        ptyIdsByTabId: selectLivePtyIdsForWorktree(state, worktreeId),
        terminalLayoutsByTabId,
        runtimeAgentOrchestrationByPaneKey:
          singletonOrchestration ??
          orchestrationByWorktree?.get(worktreeId) ??
          EMPTY_WORKTREE_AGENT_ORCHESTRATION,
        now
      })
    )
    const subagentsByParentPaneKey = includeCardDetails
      ? new Map<string, DashboardCardSubagent[]>()
      : undefined
    if (subagentsByParentPaneKey) {
      for (const row of rows) {
        if (row.rowSource !== 'subagent') {
          continue
        }
        const parentPaneKey = row.entry.orchestration?.parentPaneKey
        if (!parentPaneKey) {
          continue
        }
        const subagent: DashboardCardSubagent = {
          id: row.paneKey,
          name:
            dashboardOptionalText(row.entry.orchestration?.displayName) ??
            dashboardOptionalText(row.entry.prompt) ??
            row.agentType,
          dotState: row.state
        }
        const existing = subagentsByParentPaneKey.get(parentPaneKey)
        if (existing) {
          existing.push(subagent)
        } else {
          subagentsByParentPaneKey.set(parentPaneKey, [subagent])
        }
      }
    }
    const context = includeCardDetails
      ? resolveDashboardCardContext(state, repo, worktree)
      : undefined

    for (const row of rows) {
      // Child rows have no pane of their own; the board lists top-level agents.
      if (row.rowSource === 'subagent') {
        continue
      }
      // Title-derived rows (a live pane read only from its terminal title, no
      // agent-hook status) carry synthetic prompt/lastAssistantMessage — the
      // agent LABEL and a status word like "Idle". startedAt === 0 marks them.
      const isTitleDerived = row.startedAt === 0
      const routingPaneKey = row.activationPaneKey ?? row.paneKey
      const parsed = parsePaneKey(routingPaneKey)
      const tabId = parsed?.tabId ?? row.tab.id
      const leafId = parsed?.leafId ?? null
      const layoutPtyId =
        (leafId ? terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId] : undefined) ?? null
      // Layout entries survive app restarts, but their PTYs may not (parked
      // tabs keep the pre-restart id). Only advertise a pty the terminal
      // preview can actually serialize — ptyIdsByTabId is the liveness truth.
      const ptyId =
        layoutPtyId && (state.ptyIdsByTabId?.[tabId] ?? []).includes(layoutPtyId)
          ? layoutPtyId
          : null
      const dotState = row.state as DashboardCardDotState
      const bucket = dashboardBucketForState(row.state)
      // Why: only a live pty can open a preview terminal, and only a
      // card-rendering caller can open one — the sidebar's bucket counts must
      // not pay host resolution on every agent-status tick.
      const terminalInput =
        ptyId && includeCardDetails
          ? resolveDashboardCardTerminalInput(state, {
              ptyId,
              worktreeId,
              paneKey: routingPaneKey,
              cwd: row.tab.startupCwd ?? worktree.path,
              shellOverride: row.tab.shellOverride,
              launchAgent: row.tab.launchAgent,
              clientPlatform: clientHost.platform,
              userAgent: clientHost.userAgent,
              osRelease: clientHost.osRelease
            })
          : null
      repoIconsByRepoId[workspace.projectId] = workspace.repoIcon

      const lastAgentMessage = isTitleDerived
        ? undefined
        : dashboardOptionalText(row.entry.lastAssistantMessage)
      cards.push({
        paneKey: row.paneKey,
        ptyId,
        agentType: row.agentType,
        bucket,
        dotState,
        task: isTitleDerived ? '' : dashboardCardTask(row),
        repoId: workspace.projectId,
        worktreeId,
        tabId,
        leafId,
        parentPaneKey: dashboardCardParentPaneKey(row),
        repoName: boundedDashboardLabel(workspace.projectName),
        worktreeName: boundedDashboardLabel(worktree.displayName),
        hostKind: dashboardCardHostKind(
          workspace,
          ptyId,
          terminalInput ?? undefined,
          clientHost.platform
        ),
        workspaceKind: workspace.workspaceKind,
        workspaceStatusId: context?.workspaceStatus.id,
        workspaceStatusLabel: context?.workspaceStatus.label,
        workspaceStatusColor: context?.workspaceStatus.color,
        hasReview: context ? context.hasReview || context.review !== undefined : undefined,
        review: context?.review,
        subagents: subagentsByParentPaneKey?.get(row.paneKey),
        lastUserMessage: isTitleDerived ? undefined : dashboardOptionalText(row.entry.prompt),
        lastAgentMessage,
        ...(lastAgentMessage ? { lastResponseAt: row.entry.updatedAt } : {}),
        startedAt: row.startedAt,
        finishedAt: lastEnteredDoneAt(row),
        stateChangedAt: row.entry.stateStartedAt || row.startedAt,
        // Matches WorktreeCardAgents' unvisited derivation.
        unseen:
          !isTitleDerived &&
          (state.acknowledgedAgentsByPaneKey?.[row.paneKey] ?? 0) < row.entry.stateStartedAt,
        askSummary: bucket === 'attention' ? (row.entry.interactivePrompt ?? undefined) : undefined,
        conversationName: boundedDashboardLabelOrUndefined(
          dashboardCardConversationName(row, generatedTitlesEnabled)
        ),
        ...(terminalInput ? { terminalInput } : {}),
        // Resume identity for the pop-out's chat panel; absent until the hook reports it.
        ...(row.entry.providerSession?.id ? { sessionId: row.entry.providerSession.id } : {}),
        ...(row.entry.providerSession?.transcriptPath
          ? { transcriptPath: row.entry.providerSession.transcriptPath }
          : {})
      })
    }
  }

  return {
    generatedAt: now,
    cards,
    showIdle: state.settings?.experimentalAgentDashboardShowIdle === true,
    filterOptions,
    launchableAgentsByWorktreeId: buildDashboardWorktreeLaunchOptions(state, cards),
    repoIconsByRepoId
  }
}
