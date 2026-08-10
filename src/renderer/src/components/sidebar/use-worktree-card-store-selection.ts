import { useShallow } from 'zustand/react/shallow'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import {
  selectRuntimeAwareSshStatus,
  selectRuntimeAwareSshTargetLabel,
  selectRuntimeAwareSshTargetRemoved
} from '@/store/slices/runtime-environment-ssh'
import { DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE } from '../../../../shared/constants'
import {
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host'
import { getHostSettingOverride } from '../../../../shared/host-setting-overrides'
import type { Repo, Worktree } from '../../../../shared/types'

const EMPTY_WORKSPACE_PORTS = []

export function useWorktreeCardStoreSelection(worktree: Worktree, repo: Repo | undefined) {
  const parsedRepoHost = parseExecutionHostId(repo?.executionHostId)
  const runtimeOwnerEnvironmentId =
    worktree.runtimeOwnerEnvironmentId ??
    (parsedRepoHost?.kind === 'runtime' ? parsedRepoHost.environmentId : null)
  const runtimeHostId = runtimeOwnerEnvironmentId
    ? toRuntimeExecutionHostId(runtimeOwnerEnvironmentId)
    : null

  return useAppStore(
    useShallow((state) => {
      const settings = state.settings
      const connectionId = repo?.connectionId
      const sshOwnerEnvironmentId = connectionId
        ? getExplicitRuntimeEnvironmentIdForWorktree(state, worktree.id)
        : null
      const runtimeEnvironmentName = runtimeOwnerEnvironmentId
        ? (state.runtimeEnvironments.find(
            (environment) => environment.id === runtimeOwnerEnvironmentId
          )?.name ?? null)
        : null

      return {
        openModal: state.openModal,
        openTaskPage: state.openTaskPage,
        openAutomationsPage: state.openAutomationsPage,
        setPendingAutomationRunNavigation: state.setPendingAutomationRunNavigation,
        updateWorktreeMeta: state.updateWorktreeMeta,
        deleteFolderWorkspace: state.deleteFolderWorkspace,
        setActiveWorktree: state.setActiveWorktree,
        renamingWorktreeId: state.renamingWorktreeId,
        setRenamingWorktreeId: state.setRenamingWorktreeId,
        fetchHostedReviewForBranch: state.fetchHostedReviewForBranch,
        settings,
        fetchIssue: state.fetchIssue,
        fetchLinearIssue: state.fetchLinearIssue,
        cardProps: state.worktreeCardProperties,
        agentActivityDisplayMode:
          state.agentActivityDisplayMode ?? DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE,
        projectGroups: state.projectGroups,
        deleteState: state.deleteStateByWorktreeId[worktree.id],
        conflictOperation: state.gitConflictOperationByWorktree[worktree.id],
        remoteBranchConflict: state.remoteBranchConflictByWorktreeId[worktree.id],
        workspacePorts:
          getWorkspacePortsByWorktreeId(state.workspacePortScan?.result).get(worktree.id) ??
          EMPTY_WORKSPACE_PORTS,
        sshOwnerEnvironmentId,
        sshStatus:
          !connectionId || isRuntimeOwnedSshTargetId(connectionId)
            ? null
            : selectRuntimeAwareSshStatus(state, sshOwnerEnvironmentId, connectionId),
        sshTargetRemoved:
          connectionId && !isRuntimeOwnedSshTargetId(connectionId)
            ? selectRuntimeAwareSshTargetRemoved(state, sshOwnerEnvironmentId, connectionId)
            : false,
        sshTargetLabel: connectionId
          ? selectRuntimeAwareSshTargetLabel(state, sshOwnerEnvironmentId, connectionId)
          : '',
        isRuntimeHost: parsedRepoHost?.kind === 'runtime',
        runtimeHostLabel: runtimeHostId
          ? (getHostSettingOverride(settings, runtimeHostId, 'displayLabel') ??
            runtimeEnvironmentName)
          : null,
        isRuntimeDisconnected: runtimeOwnerEnvironmentId
          ? !state.runtimeStatusByEnvironmentId.get(runtimeOwnerEnvironmentId)?.status
          : false,
        linearStatus: state.linearStatus
      }
    })
  )
}

type WorktreeCardCacheSelection = {
  hostedReviewCacheKey: string
  issueCacheKey: string
  linearIssueCacheKey: string
  linkedLinearIssue: string | null | undefined
  prCacheKey: string
}

export function useWorktreeCardCacheSelection({
  hostedReviewCacheKey,
  issueCacheKey,
  linearIssueCacheKey,
  linkedLinearIssue,
  prCacheKey
}: WorktreeCardCacheSelection) {
  return useAppStore(
    useShallow((state) => ({
      hostedReviewEntry: hostedReviewCacheKey
        ? state.hostedReviewCache[hostedReviewCacheKey]
        : undefined,
      prCacheEntry: prCacheKey ? state.prCache?.[prCacheKey] : undefined,
      issueEntry: issueCacheKey ? state.issueCache[issueCacheKey] : undefined,
      linearIssueEntry: linearIssueCacheKey
        ? state.linearIssueCache[linearIssueCacheKey]
        : undefined,
      linearIssueFallbackEntry: linkedLinearIssue
        ? state.linearIssueCache[linkedLinearIssue]
        : undefined
    }))
  )
}
