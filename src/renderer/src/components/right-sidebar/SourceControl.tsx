/* eslint-disable max-lines */
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { selectWorktreeDiffCommentsOrEmpty } from '@/store/worktree-diff-comments-selector'
import { isSyncPushStageError } from '@/lib/source-control-remote-error'
import { useActiveWorktree, useRepoById, useWorktreeMap } from '@/store/selectors'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review'
import { getGitHubPRCacheKey } from '@/store/slices/github-cache-key'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { DropdownActionKind } from './source-control-dropdown-items'
import { BulkActionBar } from './BulkActionBar'
import { useSourceControlSelection } from './useSourceControlSelection'
import { useSourceControlSubmoduleStatus } from './useSourceControlSubmoduleStatus'
import { resolveSourceControlGroupOrder } from './source-control-section-order'
import { selectReviewCacheData, selectReviewCacheEntry } from './review-cache-entry-selection'
import { refreshGitStatusForWorktreeStrict } from './git-status-refresh'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { formatDiffComments } from '@/lib/diff-comments-format'
import {
  countPendingDiffCommentsClear,
  formatPendingDiffCommentsClearDescription,
  resolvePendingDiffCommentsClear,
  type PendingDiffCommentsClear
} from './diff-comments-clear-dialog-state'
import { readSourceControlLaunchRecipeAgentId } from '@/lib/source-control-launch-agent-selection'
import { getConnectionId } from '@/lib/connection-context'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import {
  abortRuntimeGitMerge,
  abortRuntimeGitRebase,
  bulkStageRuntimeGitPaths,
  cancelRuntimeGenerateCommitMessage,
  cancelRuntimeGeneratePullRequestFields,
  commitRuntimeGit,
  generateRuntimeCommitMessage,
  generateRuntimePullRequestFields,
  getRuntimeGitBranchCompare,
  type RuntimeGitContext,
  type RuntimeGenerateCommitMessageOverrides,
  type RuntimeGeneratePullRequestFieldsOverrides
} from '@/runtime/runtime-git-client'

import { stripBaseRef, useCreatePullRequestDialogFields } from './useCreatePullRequestDialogFields'
import { resolveCreateReviewDraftTitle } from './create-review-draft-title'
import { GitHistoryPanel } from './GitHistoryPanel'
import { useGitHistoryCommitActions } from './useGitHistoryCommitActions'
import { normalizeHostedReviewHeadRef } from '../../../../shared/hosted-review-refs'
import {
  isBehindOnlyUpstream,
  shouldForcePushWithLeaseForUpstream
} from '../../../../shared/git-upstream-status'
import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import type { GitConflictOperation, GitStatusEntry } from '../../../../shared/git-status-types'
import type { GitPushTarget } from '../../../../shared/worktree/types'
import type {
  HostedReviewCreationEligibility,
  HostedReviewInfo,
  HostedReviewProvider
} from '../../../../shared/hosted-review'
import { resolveHostedReviewCreationProvider } from '../../../../shared/hosted-review-creation-providers'
import { isCustomAgentId } from '../../../../shared/commit-message-agent-spec'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { resolveSourceControlLaunchPlatform } from '@/lib/source-control-launch-platform'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  loadSessionCommitDrafts,
  saveSessionCommitDrafts
} from '@/lib/source-control-commit-draft-session'
import { isSourceControlSplitOpenModifier } from './source-control-split-open'
import { CreateHostedReviewComposer } from './CreateHostedReviewComposer'
import { useHostedReviewStackParent } from './useHostedReviewStackParent'
import { resolveCreatedHostedReviewLink } from './source-control-created-review-link'
import {
  hasConfiguredCommitMessageGenerationDefaults,
  hasConfiguredSourceControlTextGenerationDefaults
} from './source-control-text-generation-defaults'
import { useSourceControlAi } from './use-source-control-ai'
import { translate } from '@/i18n/i18n'
import {
  localizedHostedReviewCopy,
  resolveSupportedHostedReviewCopyProvider
} from '@/i18n/hosted-review-localized-copy'
import {
  createCreatePrIntentRunToken,
  createPrIntentCurrentTargetConflictsWithToken,
  createPrIntentGitStatusMatchesToken,
  createPrIntentRunTokenMatches,
  getCreatePrIntentCommitFailureNoticeMessage,
  getCreatePrIntentStagePaths,
  resolveCreatePrIntentReviewBase,
  resolveCreatePrIntentGeneratedReviewFields,
  resolveCreatePrIntentRemoteStep,
  shouldAttemptCreateHostedReviewForIntent,
  shouldGenerateHostedReviewDetailsForIntent,
  type CreatePrIntentRunToken
} from './source-control-create-pr-intent-flow'
import { resolveBlockedCreateReviewNoticeMessage } from './source-control-create-review-blocked-action'
import {
  buildCreatePrIntentUnavailableEligibility,
  buildLoadingHostedReviewCreationEligibility,
  buildLocalBlockerHostedReviewCreationEligibility,
  resolveHostedReviewCreationProviderForTarget
} from './source-control-hosted-review-creation-eligibility-snapshot'
import { resolveProvisionalHostedReviewProvider } from './source-control-primary-create-pr-intent-action'
import {
  getNextSourceControlViewMode,
  shouldShowSourceControlCompareUnavailableCard,
  SourceControlHeaderToolbar
} from './source-control-header-toolbar'
import {
  hasPositiveHostedReviewNumberLink,
  hasResolvableHostedReviewPushTargetLink,
  hasUsableHostedReviewPushTarget,
  resolveHostedReviewActionUpstreamStatus,
  resolveHostedReviewStateForActions
} from './source-control-hosted-review-push-target'
import { buildSourceControlManualReviewUrlFromContext } from './source-control-manual-review-url'
import { parseRemoteRepo } from './source-control-remote-repo'
import { setBranchLineTotalMergeBase } from './branch-line-total-request-gate'
export { HostedReviewHeaderLink } from './hosted-review-header-chrome'
import {
  createRunningCommitMessageGenerationRecord,
  getCommitMessageGenerationRecordKey,
  markCommitMessageGenerationHydrated,
  resolveCommitMessageGenerationCancel,
  resolveCommitMessageGenerationFailure,
  resolveCommitMessageGenerationSuccess,
  type CommitMessageGenerationRecord
} from '@/store/slices/commit-message-generation'
import {
  createRunningPullRequestGenerationRecord,
  getPullRequestGenerationRecordKey,
  getPullRequestGenerationSeedRestoreKey,
  markPullRequestGenerationTerminalSeedRestored,
  resolvePullRequestGenerationCancel,
  resolvePullRequestGenerationFailure,
  resolvePullRequestGenerationSuccess,
  shouldHydratePullRequestGenerationResult,
  type PullRequestFieldRevisions,
  type PullRequestGenerationContext,
  type PullRequestGenerationFields
} from '@/store/slices/pull-request-generation'
import {
  captureSourceControlRecoveryEntrySnapshot,
  type SourceControlActionError,
  type SourceControlRecoveryStatusEntry
} from './source-control-action-error'
import { deriveSourceControlPushRecovery } from './source-control-push-recovery'
import { CommitArea } from './source-control-commit-area'
import type { CreatePrIntentNotice } from './source-control-commit-area-types'
import { handleSourceControlCommitShortcut } from './source-control-commit-shortcut'
import {
  resolveSourceControlBaseRef,
  resolveSourceControlCompareBaseRef,
  resolveSourceControlPickerBaseRef
} from './source-control-base-ref-resolution'
import {
  normalizeSourceControlViewMode,
  readCommitDraftForWorktree,
  writeCommitDraftForWorktree,
  type CommitDraftsByWorktree
} from './source-control-commit-drafts'
import { shouldRenderCommitArea } from './source-control-component-gates'
import {
  clearRemoteActionErrorsForCompletedConflictOperations,
  refreshSourceControlAfterRemoteAction,
  resolveRemoteActionError
} from './source-control-remote-refresh'
import { CompareUnavailable } from './source-control-compare-summary'
import { SourceControlNotesShelf } from './source-control-notes-shelf'
import { useCopyFeedbackState } from './source-control-copy-feedback'
import { useSourceControlBranchCompare } from './use-source-control-branch-compare'
import { useSourceControlGitHistory } from './use-source-control-git-history'
import { useSourceControlFileProjection } from './use-source-control-file-projection'
import { useSourceControlEntryMutations } from './use-source-control-entry-mutations'
import { useSourceControlDiscardConfirmation } from './use-source-control-discard-confirmation'
import { useSourceControlStatusRefresh } from './use-source-control-status-refresh'
import { SourceControlBranchSection } from './source-control-branch-section'
import { useSourceControlNoteOpening } from './use-source-control-note-opening'
import { useSourceControlBaseRefDefault } from './use-source-control-base-ref-default'
import { useSourceControlRowOpening } from './use-source-control-row-opening'
import { useSourceControlBulkActions } from './use-source-control-bulk-actions'
import { useSourceControlActionModel } from './use-source-control-action-model'
import { SourceControlUncommittedSections } from './source-control-uncommitted-sections'
import { SourceControlContentStatus } from './source-control-content-status'
import { SourceControlDialogLayer } from './source-control-dialog-layer'
import { SourceControlForkPushNotice } from './source-control-fork-push-notice'

export {
  CompareSummary,
  CompareSummaryToolbarButton,
  shouldRefreshBranchCompareForRemoteStatus,
  shouldRefreshBranchCompareForStatusHead,
  shouldShowCompareSummary
} from './source-control-compare-summary'
export { ConflictSummaryCard, OperationBanner } from './source-control-conflict-status-cards'
export { TooManyChangesBanner } from './source-control-too-many-changes-banner'
export { ActionButton } from './source-control-action-button'
export { BRANCH_REFRESH_INTERVAL_MS } from './use-source-control-branch-compare'
export { CommitArea } from './source-control-commit-area'
export { handleSourceControlCommitShortcut } from './source-control-commit-shortcut'
export {
  resolveSourceControlBaseRef,
  resolveSourceControlCompareBaseRef,
  resolveSourceControlPickerBaseRef,
  shouldClearBranchCompareForMissingBase
} from './source-control-base-ref-resolution'
export {
  normalizeSourceControlViewMode,
  readCommitDraftForWorktree,
  writeCommitDraftForWorktree
} from './source-control-commit-drafts'
export {
  pickDefaultSourceControlAgent,
  shouldRenderCommitArea
} from './source-control-component-gates'
export {
  clearRemoteActionErrorsForCompletedConflictOperations,
  refreshSourceControlAfterRemoteAction
} from './source-control-remote-refresh'

export {
  appendCommitFailureCustomInstruction,
  appendPushFailureCustomInstruction,
  buildCommitFailureAgentCommandInput,
  buildFixCommitFailurePrompt,
  buildFixPushFailurePrompt,
  buildPushFailureAgentCommandInput,
  buildResolveConflictsPrompt,
  buildResolvePullRequestConflictsPrompt
} from './source-control-ai-prompts'
export {
  hasConfiguredCommitMessageGenerationDefaults,
  hasConfiguredSourceControlTextGenerationDefaults
} from './source-control-text-generation-defaults'

type AbortConflictOperation = Extract<GitConflictOperation, 'merge' | 'rebase'>
type SourceControlOperationTarget = RuntimeGitContext & {
  worktreeId: string
  pushTarget?: GitPushTarget
}
type HostedReviewCreatedContext = {
  repoPath: string
  repoId: string
  branch: string
  worktreeId: string | null
  openChecks: boolean
}
const EMPTY_GIT_STATUS_ENTRIES: GitStatusEntry[] = []
const EMPTY_BRANCH_CHANGE_ENTRIES: GitBranchChangeEntry[] = []
const DEFAULT_COLLAPSED_SECTIONS = ['history'] as const
function createDefaultCollapsedSections(): Set<string> {
  return new Set(DEFAULT_COLLAPSED_SECTIONS)
}

// The primary-action state machine now lives in ./source-control-primary-action.ts, imported directly by callers.

type HostedReviewCreationState = {
  repoId: string
  worktreeId: string
  branch: string
  data: HostedReviewCreationEligibility
}

type HostedReviewCreationRequestState = {
  repoId: string
  worktreeId: string
  branch: string
  status: 'loading' | 'failed'
}

type HostedReviewCreationProviderHint = {
  repoId: string | null
  worktreeId: string | null
  branch: string
  provider: HostedReviewProvider
}

type CreatedHostedReview = {
  provider: HostedReviewProvider
  number: number
  url: string
}

function SourceControlInner(): React.JSX.Element {
  const sourceControlRef = useRef<HTMLDivElement | null>(null)
  // Why: virtualize against the panel's shared scroller; use state (not a ref) so lists re-render and start observing once the element attaches.
  const [fileListScrollElement, setFileListScrollElement] = useState<HTMLDivElement | null>(null)
  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  // Why: setState is async, so a double-click can pass the isCommitting guard before re-render; a synchronously-flipped ref gives a true single-flight lock.
  const commitInFlightRef = useRef<Record<string, boolean>>({})
  const activeWorktree = useActiveWorktree()
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktreeInstanceId = activeWorktree?.instanceId
  const activeGroupId = useAppStore((s) =>
    activeWorktreeId ? s.activeGroupIdByWorktree[activeWorktreeId] : undefined
  )
  const worktreeMap = useWorktreeMap()
  const rightSidebarTab = useAppStore((s) => s.rightSidebarTab)
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const activeRepoId = activeRepo?.id ?? null
  const activeRepoPath = activeRepo?.path ?? null
  const activeRepoConnectionId = activeRepo?.connectionId ?? null
  const activeRepoExecutionHostId = activeRepo?.executionHostId ?? null
  const gitIdentityDisplay = activeWorktree ? getWorktreeGitIdentityDisplay(activeWorktree) : null
  const branchName = gitIdentityDisplay?.kind === 'branch' ? gitIdentityDisplay.branchName : ''
  const entries = useAppStore((s) =>
    activeWorktreeId
      ? (s.gitStatusByWorktree[activeWorktreeId] ?? EMPTY_GIT_STATUS_ENTRIES)
      : EMPTY_GIT_STATUS_ENTRIES
  )
  const activeGitStatusHead = useAppStore((s) =>
    activeWorktreeId ? (s.gitStatusHeadByWorktree?.[activeWorktreeId] ?? null) : null
  )
  const repositoryHuge = useAppStore((s) =>
    activeWorktreeId ? s.gitStatusHugeByWorktree?.[activeWorktreeId] : undefined
  )
  const branchEntries = useAppStore((s) =>
    activeWorktreeId
      ? (s.gitBranchChangesByWorktree[activeWorktreeId] ?? EMPTY_BRANCH_CHANGE_ENTRIES)
      : EMPTY_BRANCH_CHANGE_ENTRIES
  )
  const branchSummary = useAppStore((s) =>
    activeWorktreeId ? (s.gitBranchCompareSummaryByWorktree[activeWorktreeId] ?? null) : null
  )
  const publishedBranchLineTotal = useAppStore((s) =>
    activeWorktreeId ? (s.gitBranchLineTotalByWorktree?.[activeWorktreeId] ?? null) : null
  )
  // Why: status and branch compare refresh on different cadences, so a total can
  // outlive the fork point it measured. Drop it rather than render a stale number.
  const branchLineTotal =
    publishedBranchLineTotal && publishedBranchLineTotal.mergeBase === branchSummary?.mergeBase
      ? publishedBranchLineTotal
      : null
  const conflictOperation = useAppStore((s) =>
    activeWorktreeId ? (s.gitConflictOperationByWorktree[activeWorktreeId] ?? 'unknown') : 'unknown'
  )
  const conflictOperationsByWorktree = useAppStore((s) => s.gitConflictOperationByWorktree)
  // Why: leave undefined until fetchUpstreamStatus resolves; a synthetic "no upstream" flashes "Publish Branch" on worktree switch.
  const remoteStatus = useAppStore((s) =>
    activeWorktreeId ? s.remoteStatusesByWorktree[activeWorktreeId] : undefined
  )
  const isRemoteOperationActive = useAppStore((s) => s.isRemoteOperationActive)
  const inFlightRemoteOpKind = useAppStore((s) => s.inFlightRemoteOpKind)
  const settings = useAppStore((s) => s.settings)
  const hostedReviewCacheKey =
    activeRepo && branchName
      ? getHostedReviewCacheKey(
          activeRepo.path,
          branchName,
          settings,
          activeRepo.id,
          activeRepo.connectionId,
          activeRepo.executionHostId,
          true
        )
      : null
  const activePrCacheKey =
    activeRepo && branchName
      ? getGitHubPRCacheKey(
          activeRepo.path,
          activeRepo.id,
          branchName,
          settings,
          activeRepo.connectionId,
          activeRepo.executionHostId,
          true
        )
      : null
  // Why: background review refreshes replace both cache maps; this panel only needs its active repo/branch entries.
  const hostedReviewEntry = useAppStore((s) =>
    selectReviewCacheEntry(s.hostedReviewCache, hostedReviewCacheKey)
  )
  const hostedReviewEntryData = hostedReviewEntry?.data ?? null
  const activePrFromQueue = useAppStore((s) => selectReviewCacheData(s.prCache, activePrCacheKey))
  // Why: git/file mutations and repo metadata belong to the repo OWNER host, not the currently focused sidebar host.
  const activeRepoSettings = useMemo(
    () =>
      getRepoOwnerRoutedSettings(
        settings,
        activeRepoId
          ? {
              id: activeRepoId,
              connectionId: activeRepoConnectionId,
              executionHostId: activeRepoExecutionHostId
            }
          : null
      ),
    [activeRepoConnectionId, activeRepoExecutionHostId, activeRepoId, settings]
  )
  const activeRepoRuntimeEnvironmentId = activeRepoSettings?.activeRuntimeEnvironmentId ?? null
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const fetchHostedReviewForBranch = useAppStore((s) => s.fetchHostedReviewForBranch)
  const getHostedReviewCreationEligibility = useAppStore(
    (s) => s.getHostedReviewCreationEligibility
  )
  const createHostedReview = useAppStore((s) => s.createHostedReview)
  const createStackedHostedReview = useAppStore((s) => s.createStackedHostedReview)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const fetchPRForBranch = useAppStore((s) => s.fetchPRForBranch)
  const enqueueGitHubPRRefresh = useAppStore((s) => s.enqueueGitHubPRRefresh)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const setGitStatus = useAppStore((s) => s.setGitStatus)
  const updateWorktreeGitIdentity = useAppStore((s) => s.updateWorktreeGitIdentity)
  const beginGitBranchCompareRequest = useAppStore((s) => s.beginGitBranchCompareRequest)
  const setGitBranchCompareResult = useAppStore((s) => s.setGitBranchCompareResult)
  const fetchUpstreamStatus = useAppStore((s) => s.fetchUpstreamStatus)
  const ensureHostedReviewPushTarget = useAppStore((s) => s.ensureHostedReviewPushTarget)
  const setUpstreamStatus = useAppStore((s) => s.setUpstreamStatus)
  const pushBranch = useAppStore((s) => s.pushBranch)
  const pullBranch = useAppStore((s) => s.pullBranch)
  const fastForwardBranch = useAppStore((s) => s.fastForwardBranch)
  const syncBranch = useAppStore((s) => s.syncBranch)
  const rebaseFromBase = useAppStore((s) => s.rebaseFromBase)
  const fetchBranch = useAppStore((s) => s.fetchBranch)
  const revealInExplorer = useAppStore((s) => s.revealInExplorer)
  const openConflictReview = useAppStore((s) => s.openConflictReview)
  const openAllDiffs = useAppStore((s) => s.openAllDiffs)
  const openBranchAllDiffs = useAppStore((s) => s.openBranchAllDiffs)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const clearDiffComments = useAppStore((s) => s.clearDiffComments)
  const clearDiffCommentsForFile = useAppStore((s) => s.clearDiffCommentsForFile)
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen)
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab)
  // Why: pass activeWorktreeId even when null so the selector returns its stable empty sentinel; an inline [] would break Zustand's Object.is and churn.
  const diffCommentsForActive = useAppStore((s) =>
    selectWorktreeDiffCommentsOrEmpty(s, activeWorktreeId)
  )
  const diffCommentCount = diffCommentsForActive.length
  // Why: compute per-file comment counts once per render so rows don't each re-filter the full list.
  const diffCommentCountByPath = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of diffCommentsForActive) {
      map.set(c.filePath, (map.get(c.filePath) ?? 0) + 1)
    }
    return map
  }, [diffCommentsForActive])
  const diffCommentsPrompt = useMemo(
    () => formatDiffComments(diffCommentsForActive),
    [diffCommentsForActive]
  )
  const [diffCommentsExpanded, setDiffCommentsExpanded] = useState(false)
  const [diffCommentsCopied, showDiffCommentsCopied] = useCopyFeedbackState(false)
  const [pendingDiffCommentsClear, setPendingDiffCommentsClear] =
    useState<PendingDiffCommentsClear | null>(null)
  const [isClearingDiffComments, setIsClearingDiffComments] = useState(false)
  const handleCopyDiffComments = useCallback(async (): Promise<void> => {
    if (diffCommentsForActive.length === 0) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(diffCommentsPrompt)
      showDiffCommentsCopied(true)
    } catch {
      // Why: swallow — clipboard write can fail when unfocused; best-effort copy needs no error surface.
    }
  }, [diffCommentsForActive, diffCommentsPrompt, showDiffCommentsCopied])

  const pendingDiffCommentsClearCount = useMemo(() => {
    return countPendingDiffCommentsClear(
      pendingDiffCommentsClear,
      activeWorktreeId,
      diffCommentsForActive
    )
  }, [activeWorktreeId, diffCommentsForActive, pendingDiffCommentsClear])

  const resolvedPendingDiffCommentsClear = resolvePendingDiffCommentsClear({
    activeWorktreeId,
    isClearing: isClearingDiffComments,
    pending: pendingDiffCommentsClear,
    pendingCount: pendingDiffCommentsClearCount
  })
  if (resolvedPendingDiffCommentsClear !== pendingDiffCommentsClear) {
    // Why: the confirmation is local UI state; clear impossible ones before children observe a stale open dialog.
    setPendingDiffCommentsClear(resolvedPendingDiffCommentsClear)
  }

  const pendingDiffCommentsClearDescription = formatPendingDiffCommentsClearDescription(
    resolvedPendingDiffCommentsClear,
    pendingDiffCommentsClearCount
  )

  const handleConfirmDiffCommentsClear = useCallback(async (): Promise<void> => {
    const pending = resolvedPendingDiffCommentsClear
    if (!pending || isClearingDiffComments || pending.worktreeId !== activeWorktreeId) {
      return
    }
    if (pendingDiffCommentsClearCount === 0) {
      setPendingDiffCommentsClear(null)
      return
    }
    setIsClearingDiffComments(true)
    try {
      const ok =
        pending.kind === 'all'
          ? await clearDiffComments(pending.worktreeId)
          : await clearDiffCommentsForFile(pending.worktreeId, pending.filePath)
      if (ok) {
        setPendingDiffCommentsClear(null)
      } else {
        toast.error(
          translate(
            'auto.components.right.sidebar.SourceControl.eae7a1da5f',
            'Failed to clear notes.'
          )
        )
      }
    } finally {
      setIsClearingDiffComments(false)
    }
  }, [
    activeWorktreeId,
    clearDiffComments,
    clearDiffCommentsForFile,
    isClearingDiffComments,
    resolvedPendingDiffCommentsClear,
    pendingDiffCommentsClearCount
  ])

  const [filterExpanded, setFilterExpanded] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    createDefaultCollapsedSections
  )
  const persistedSourceControlViewMode = normalizeSourceControlViewMode(
    settings?.sourceControlViewMode
  )
  const sourceControlViewMode = persistedSourceControlViewMode
  const sourceControlGroupOrder = resolveSourceControlGroupOrder(settings?.sourceControlGroupOrder)
  const [collapsedTreeDirs, setCollapsedTreeDirs] = useState<Set<string>>(new Set())
  const [baseRefDialogOpen, setBaseRefDialogOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  // Why: Source Control unmounts on tab switch; keep commit drafts in a module-scoped session cache and restore on remount.
  const [commitDrafts, setCommitDrafts] = useState<CommitDraftsByWorktree>(() =>
    loadSessionCommitDrafts()
  )
  const commitDraftsRef = useRef<CommitDraftsByWorktree>(commitDrafts)
  const commitErrorsRef = useRef<Record<string, string | null>>({})
  const [commitErrors, setCommitErrors] = useState<Record<string, string | null>>({})
  const [remoteActionErrors, setRemoteActionErrors] = useState<
    Record<string, SourceControlActionError | null>
  >({})
  const remoteActionErrorSequenceByWorktreeRef = useRef<Record<string, number>>({})
  const previousConflictOperationsRef = useRef<Record<string, GitConflictOperation>>({})
  // Why: keep commit-in-flight per-worktree; a single boolean would clear on worktree switch, allowing a double-commit on the original.
  const [commitInFlightByWorktree, setCommitInFlightByWorktree] = useState<Record<string, boolean>>(
    {}
  )
  const [abortOperationInFlightByWorktree, setAbortOperationInFlightByWorktree] = useState<
    Record<string, boolean>
  >({})
  const isAbortingOperation = abortOperationInFlightByWorktree[activeWorktreeId ?? ''] ?? false
  const confirmAction = useConfirmationDialog()
  const isCommitting = commitInFlightByWorktree[activeWorktreeId ?? ''] ?? false
  // Why: per-worktree shape (like commit) so navigating worktrees mid-generation never cancels the in-flight request.
  const generateInFlightRef = useRef<Record<string, boolean>>({})
  const [generateInFlightByWorktree, setGenerateInFlightByWorktree] = useState<
    Record<string, boolean>
  >({})
  const [generateErrors, setGenerateErrors] = useState<Record<string, string | null>>({})
  const [hostedReviewCreationState, setHostedReviewCreationState] =
    useState<HostedReviewCreationState | null>(null)
  const [hostedReviewCreationRequestState, setHostedReviewCreationRequestState] =
    useState<HostedReviewCreationRequestState | null>(null)
  const hostedReviewCreationProviderHintRef = useRef<HostedReviewCreationProviderHint>({
    repoId: null,
    worktreeId: null,
    branch: '',
    provider: 'github'
  })
  const createPrInFlightRef = useRef<Record<string, boolean>>({})
  const [createPrInFlightByWorktree, setCreatePrInFlightByWorktree] = useState<
    Record<string, boolean>
  >({})
  const isCreatingPr = createPrInFlightByWorktree[activeWorktreeId ?? ''] ?? false
  const createPrIntentInFlightRef = useRef<Record<string, boolean>>({})
  const createPrIntentRunTokenRef = useRef<Record<string, CreatePrIntentRunToken | null>>({})
  const createPrIntentCurrentTargetRef = useRef({
    repoId: null as string | null,
    worktreeId: null as string | null,
    worktreePath: null as string | null,
    branch: null as string | null,
    baseRef: null as string | null
  })
  const [createPrIntentInFlightByWorktree, setCreatePrIntentInFlightByWorktree] = useState<
    Record<string, boolean>
  >({})
  const [createPrIntentNotices, setCreatePrIntentNotices] = useState<
    Record<string, CreatePrIntentNotice | null>
  >({})
  const isCreatePrIntentInFlight = createPrIntentInFlightByWorktree[activeWorktreeId ?? ''] ?? false
  const createPrIntentNotice = createPrIntentNotices[activeWorktreeId ?? ''] ?? null
  const setCreatePrIntentNoticeForWorktree = useCallback(
    (worktreeId: string, notice: CreatePrIntentNotice | null): void => {
      setCreatePrIntentNotices((prev) => ({ ...prev, [worktreeId]: notice }))
    },
    []
  )
  const createPrIntentRunStillOwnsWorktree = useCallback(
    (token: CreatePrIntentRunToken): boolean =>
      createPrIntentRunTokenRef.current[token.worktreeId] === token,
    []
  )
  const createPrIntentActiveTargetConflicts = useCallback(
    (token: CreatePrIntentRunToken): boolean =>
      createPrIntentCurrentTargetConflictsWithToken(token, createPrIntentCurrentTargetRef.current),
    []
  )
  const getCreatePrIntentOperationTarget = useCallback(
    (token: CreatePrIntentRunToken): SourceControlOperationTarget => ({
      // Why: Create PR intent continues after navigation; pin git commands to the worktree/host that started the sequence.
      settings: activeRepoSettings,
      worktreeId: token.worktreeId,
      worktreePath: token.worktreePath,
      connectionId: getConnectionId(token.worktreeId) ?? undefined,
      pushTarget: worktreeMap.get(token.worktreeId)?.pushTarget
    }),
    [activeRepoSettings, worktreeMap]
  )
  const prGenerationRecords = useAppStore((s) => s.pullRequestGenerationRecords)
  const allocatePullRequestGenerationRequestId = useAppStore(
    (s) => s.allocatePullRequestGenerationRequestId
  )
  const setPullRequestGenerationRecord = useAppStore((s) => s.setPullRequestGenerationRecord)
  const updatePullRequestGenerationRecord = useAppStore((s) => s.updatePullRequestGenerationRecord)

  const commitMessageGenerationRecords = useAppStore((s) => s.commitMessageGenerationRecords)
  const allocateCommitMessageGenerationRequestId = useAppStore(
    (s) => s.allocateCommitMessageGenerationRequestId
  )
  const setCommitMessageGenerationRecord = useAppStore((s) => s.setCommitMessageGenerationRecord)
  const updateCommitMessageGenerationRecord = useAppStore(
    (s) => s.updateCommitMessageGenerationRecord
  )

  const commitMessage = readCommitDraftForWorktree(commitDrafts, activeWorktreeId)
  const commitError = commitErrors[activeWorktreeId ?? ''] ?? null
  const remoteActionError = remoteActionErrors[activeWorktreeId ?? ''] ?? null
  const activeRemoteActionSequence = activeWorktreeId
    ? (remoteActionErrorSequenceByWorktreeRef.current[activeWorktreeId] ?? null)
    : null
  const isGitHistoryExpanded = !collapsedSections.has('history')

  useEffect(() => {
    commitDraftsRef.current = commitDrafts
  }, [commitDrafts])

  const updateCommitDrafts = useCallback(
    (updater: (drafts: CommitDraftsByWorktree) => CommitDraftsByWorktree): void => {
      const next = updater(commitDraftsRef.current)
      // Why: Create PR intent reads this ref after awaits so it doesn't overwrite user edits made before React's passive state sync runs.
      commitDraftsRef.current = next
      setCommitDrafts(next)
    },
    []
  )
  const setCommitErrorForWorktree = useCallback(
    (worktreeId: string, message: string | null): void => {
      commitErrorsRef.current = { ...commitErrorsRef.current, [worktreeId]: message }
      setCommitErrors((prev) => ({ ...prev, [worktreeId]: message }))
    },
    []
  )

  const isFolder = activeRepo ? isFolderRepo(activeRepo) : false
  const worktreePath = activeWorktree?.path ?? null
  const { expandedSubmoduleKeys, submoduleStatusByKey, toggleSubmodule } =
    useSourceControlSubmoduleStatus({
      activeWorktreeId,
      worktreePath,
      activeRepoSettings,
      entries
    })
  const activeCommitMessageGenerationKey = getCommitMessageGenerationRecordKey(
    activeWorktreeId,
    worktreePath
  )
  const activeCommitMessageGenerationRecord: CommitMessageGenerationRecord | null =
    activeCommitMessageGenerationKey
      ? (commitMessageGenerationRecords[activeCommitMessageGenerationKey] ?? null)
      : null
  const isGenerating =
    activeCommitMessageGenerationRecord?.status === 'running' ||
    (generateInFlightByWorktree[activeWorktreeId ?? ''] ?? false)
  const generateError =
    activeCommitMessageGenerationRecord?.error ?? generateErrors[activeWorktreeId ?? ''] ?? null
  const activeConnectionId = activeWorktreeId
    ? (getConnectionId(activeWorktreeId) ?? activeRepoConnectionId)
    : null
  const activeSourceControlLaunchPlatform = resolveSourceControlLaunchPlatform({
    connectionId: activeConnectionId,
    worktreePath,
    projectRuntime: activeConnectionId
      ? undefined
      : getLocalProjectExecutionRuntimeContext(useAppStore.getState(), activeWorktreeId)
  })
  const activePullRequestGenerationKey = getPullRequestGenerationRecordKey({
    worktreeId: activeWorktreeId,
    worktreePath,
    repoId: activeRepo?.id,
    branch: branchName
  })
  const activePullRequestGenerationRecordCandidate = activePullRequestGenerationKey
    ? (prGenerationRecords[activePullRequestGenerationKey] ?? null)
    : null
  const activePullRequestGenerationRecord =
    activePullRequestGenerationRecordCandidate &&
    activePullRequestGenerationRecordCandidate.context.repoId === activeRepo?.id &&
    activePullRequestGenerationRecordCandidate.context.branch === branchName
      ? activePullRequestGenerationRecordCandidate
      : null
  const activePullRequestGenerationSeedRestoreKey = getPullRequestGenerationSeedRestoreKey({
    recordKey: activePullRequestGenerationKey,
    record: activePullRequestGenerationRecord
  })
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  // Why: the sidebar stays mounted when closed, so gate polling on tab AND open or branchCompare/PR fetch would run with no visible consumer.
  const isBranchVisible = rightSidebarTab === 'source-control' && rightSidebarOpen

  // Why: the merge base IS the request gate — no OID on the status request means
  // the host runs no ranged diff, so a hidden chip costs a background worktree nothing.
  const requestedBranchLineTotalMergeBase =
    isBranchVisible && !isFolder && branchSummary?.status === 'ready'
      ? branchSummary.mergeBase
      : null
  useEffect(() => {
    if (!activeWorktreeId) {
      return
    }
    setBranchLineTotalMergeBase(activeWorktreeId, requestedBranchLineTotalMergeBase)
    return () => {
      setBranchLineTotalMergeBase(activeWorktreeId, null)
    }
  }, [activeWorktreeId, requestedBranchLineTotalMergeBase])

  const {
    refreshActiveGitStatus,
    refreshActiveGitStatusAfterMutation,
    refreshGitStatusAfterPullRequestGeneration
  } = useSourceControlStatusRefresh({
    activeRepoSettings,
    activeWorktreeId,
    worktreePath,
    activePushTarget: activeWorktree?.pushTarget,
    isFolder,
    repositoryHuge,
    activeConnectionId,
    activeWorktreeInstanceId,
    worktreeMap
  })

  const defaultBaseRef = useSourceControlBaseRefDefault({
    activeRepoConnectionId,
    activeRepoExecutionHostId,
    activeRepoId,
    activeRepoRuntimeEnvironmentId,
    isBranchVisible,
    isFolder
  })

  const normalizedWorktreeBaseRef = activeWorktree?.baseRef?.trim() || null
  const normalizedRepoBaseRef = activeRepo?.worktreeBaseRef?.trim() || null
  const baseRefOwnedByWorktree = normalizedWorktreeBaseRef !== null
  const pinnedBaseRef = normalizedWorktreeBaseRef ?? normalizedRepoBaseRef
  const hasUncommittedEntries = entries.length > 0

  const hostedReviewCreation =
    hostedReviewCreationState &&
    activeRepo?.id === hostedReviewCreationState.repoId &&
    activeWorktreeId === hostedReviewCreationState.worktreeId &&
    branchName === hostedReviewCreationState.branch
      ? hostedReviewCreationState.data
      : null
  const hostedReviewCreateProvider = resolveHostedReviewCreationProvider(
    hostedReviewCreation?.provider
  )
  const hostedReviewCreateCopy = localizedHostedReviewCopy(hostedReviewCreateProvider)
  const hostedReview: HostedReviewInfo | null = useMemo(() => {
    if (!hostedReviewCacheKey) {
      return null
    }
    if (activePrFromQueue) {
      return { provider: 'github', ...activePrFromQueue, status: activePrFromQueue.checksStatus }
    }
    return hostedReviewEntryData
  }, [activePrFromQueue, hostedReviewCacheKey, hostedReviewEntryData])
  const effectiveBaseRef = resolveSourceControlBaseRef({
    worktreeBaseRef: normalizedWorktreeBaseRef,
    reviewBaseRefName: hostedReview?.baseRefName,
    repoBaseRef: normalizedRepoBaseRef,
    defaultBaseRef
  })
  // Why: the compare/diff view uses this base; the PR/rebase merge target keeps effectiveBaseRef (equal when the setting is off).
  const compareBaseRef = resolveSourceControlCompareBaseRef({
    enabled: settings?.sourceControlCompareAgainstUpstream ?? false,
    worktreeBaseRef: normalizedWorktreeBaseRef,
    repoBaseRef: normalizedRepoBaseRef,
    upstreamName: remoteStatus?.upstreamName ?? null,
    fallbackBaseRef: effectiveBaseRef
  })
  const pickerBaseRef = resolveSourceControlPickerBaseRef({
    pinnedBaseRef,
    effectiveBaseRef
  })
  const { refreshBranchCompare, refreshBranchCompareRef } = useSourceControlBranchCompare({
    activeRepoSettings,
    activeWorktreeId,
    worktreePath,
    compareBaseRef,
    isFolder,
    branchName,
    isBranchVisible,
    activeGitStatusHead,
    remoteStatus
  })
  useEffect(() => {
    createPrIntentCurrentTargetRef.current = {
      repoId: activeRepo?.id ?? null,
      worktreeId: activeWorktreeId ?? null,
      worktreePath,
      branch: branchName,
      baseRef: effectiveBaseRef ?? null
    }
  }, [activeRepo?.id, activeWorktreeId, branchName, effectiveBaseRef, worktreePath])

  const linkedGitHubPR = activeWorktree?.linkedPR ?? null
  const fallbackGitHubPRNumber = linkedGitHubPR == null ? (activePrFromQueue?.number ?? null) : null
  const linkedGitLabMR = activeWorktree?.linkedGitLabMR ?? null
  const linkedBitbucketPR = activeWorktree?.linkedBitbucketPR ?? null
  const linkedAzureDevOpsPR = activeWorktree?.linkedAzureDevOpsPR ?? null
  const linkedGiteaPR = activeWorktree?.linkedGiteaPR ?? null
  const manualReviewUrl = useMemo(
    () =>
      buildSourceControlManualReviewUrlFromContext({
        hostedReviewProvider: hostedReview?.provider ?? null,
        hostedReviewCreationProvider: hostedReviewCreation?.provider ?? null,
        linkedGitHubPR,
        fallbackGitHubPRNumber,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR,
        baseRef: compareBaseRef,
        branchName,
        repoRemoteName: activeRepo?.gitRemoteIdentity?.remoteName ?? null,
        repoRemoteUrl: activeRepo?.gitRemoteIdentity?.remoteUrl ?? null,
        pushTarget: activeWorktree?.pushTarget ?? null,
        upstreamName: remoteStatus?.upstreamName ?? null
      }),
    [
      activeRepo?.gitRemoteIdentity?.remoteName,
      activeRepo?.gitRemoteIdentity?.remoteUrl,
      activeWorktree?.pushTarget,
      branchName,
      compareBaseRef,
      fallbackGitHubPRNumber,
      hostedReview?.provider,
      hostedReviewCreation?.provider,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGitHubPR,
      linkedGitLabMR,
      linkedGiteaPR,
      remoteStatus?.upstreamName
    ]
  )
  const shouldResolveHostedReviewCreation =
    isBranchVisible &&
    Boolean(activeRepo) &&
    !isFolder &&
    Boolean(branchName) &&
    branchName !== 'HEAD' &&
    Boolean(activeWorktreeId)
  const hostedReviewCreationRequestMatchesCurrent =
    hostedReviewCreationRequestState !== null &&
    activeRepo?.id === hostedReviewCreationRequestState.repoId &&
    activeWorktreeId === hostedReviewCreationRequestState.worktreeId &&
    branchName === hostedReviewCreationRequestState.branch
  const isHostedReviewCreationLoading =
    shouldResolveHostedReviewCreation &&
    hostedReviewCreationRequestMatchesCurrent &&
    hostedReviewCreationRequestState.status === 'loading' &&
    hostedReview === null
  // Why: infer provider from the remote host when unknown, so a GitLab (etc.) repo shows its own review copy instead of the GitHub default.
  const remoteInferredHostedReviewProvider = useMemo(
    () => parseRemoteRepo(activeRepo?.gitRemoteIdentity?.remoteUrl ?? '')?.provider ?? null,
    [activeRepo?.gitRemoteIdentity?.remoteUrl]
  )
  const provisionalHostedReviewProvider = useMemo(
    () =>
      resolveProvisionalHostedReviewProvider({
        hostedReview,
        hostedReviewCreationState: hostedReviewCreation
          ? {
              repoId: activeRepo?.id ?? '',
              data: hostedReviewCreation
            }
          : null,
        activeRepoId: activeRepo?.id ?? null,
        linkedGitHubPR,
        fallbackGitHubPR: fallbackGitHubPRNumber,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR,
        remoteInferredProvider: remoteInferredHostedReviewProvider
      }),
    [
      activeRepo?.id,
      fallbackGitHubPRNumber,
      hostedReview,
      hostedReviewCreation,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGitHubPR,
      linkedGitLabMR,
      linkedGiteaPR,
      remoteInferredHostedReviewProvider
    ]
  )
  const resolveCurrentHostedReviewCreationProvider = useEffectEvent(() =>
    resolveHostedReviewCreationProviderForTarget(
      hostedReviewCreationProviderHintRef.current,
      { repoId: activeRepoId, worktreeId: activeWorktreeId ?? null, branch: branchName },
      // Why: provisional already infers the remote host and defaults to github; never fall back to unsupported mid-load.
      provisionalHostedReviewProvider
    )
  )
  useEffect(() => {
    const hasConcreteProviderHint =
      hostedReview !== null ||
      hostedReviewCreation !== null ||
      linkedGitHubPR !== null ||
      fallbackGitHubPRNumber !== null ||
      linkedGitLabMR !== null ||
      linkedAzureDevOpsPR !== null ||
      linkedGiteaPR !== null

    if (!hasConcreteProviderHint) {
      return
    }

    hostedReviewCreationProviderHintRef.current = {
      repoId: activeRepo?.id ?? null,
      worktreeId: activeWorktreeId ?? null,
      branch: branchName,
      provider: provisionalHostedReviewProvider
    }
  }, [
    activeRepo?.id,
    activeWorktreeId,
    branchName,
    fallbackGitHubPRNumber,
    hostedReview,
    hostedReviewCreation,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    linkedGitHubPR,
    linkedGitLabMR,
    provisionalHostedReviewProvider
  ])
  const hostedReviewCreationForHeader = useMemo(() => {
    // Why: during a fresh preflight, disable stale Create PR eligibility while state reconciles, but preserve provider copy from the last snapshot.
    if (isHostedReviewCreationLoading) {
      const provider = resolveHostedReviewCreationProviderForTarget(
        hostedReviewCreationProviderHintRef.current,
        { repoId: activeRepoId, worktreeId: activeWorktreeId ?? null, branch: branchName },
        provisionalHostedReviewProvider
      )
      return buildLoadingHostedReviewCreationEligibility(provider)
    }
    return hostedReviewCreation
  }, [
    activeRepoId,
    activeWorktreeId,
    branchName,
    hostedReviewCreation,
    isHostedReviewCreationLoading,
    provisionalHostedReviewProvider
  ])
  const hasHostedReviewLink = hasPositiveHostedReviewNumberLink({
    linkedGitHubPR,
    fallbackGitHubPR: fallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR
  })
  // Why: SSH-backed (connectionId) repos never fetch hostedReview, so skip the loading state or it would permanently block Publish Branch.
  const isHostedReviewStateLoading =
    !activeRepo?.connectionId && hasHostedReviewLink && hostedReviewEntry === undefined
  const hasResolvableReviewPushTargetLink = hasResolvableHostedReviewPushTargetLink({
    linkedGitHubPR,
    fallbackGitHubPR: fallbackGitHubPRNumber,
    linkedGitLabMR
  })
  useEffect(() => {
    // Why: resolving review heads can hit provider/SSH APIs; gate on the visible branch view like the adjacent PR polling.
    if (!isBranchVisible || isFolder || !activeWorktreeId || activeWorktree?.pushTarget) {
      return
    }
    if (!hasResolvableReviewPushTargetLink) {
      return
    }
    void ensureHostedReviewPushTarget(activeWorktreeId)
  }, [
    activeWorktree?.pushTarget,
    activeWorktreeId,
    ensureHostedReviewPushTarget,
    hasResolvableReviewPushTargetLink,
    isBranchVisible,
    isFolder
  ])
  const canUseHostedReviewPushTarget = hasUsableHostedReviewPushTarget({
    pushTarget: activeWorktree?.pushTarget,
    upstreamStatus: remoteStatus,
    hasResolvableHostedReviewPushTargetLink: hasResolvableReviewPushTargetLink,
    branchName
  })
  const hostedReviewStateForActions = resolveHostedReviewStateForActions({
    hostedReviewState: hostedReview?.state ?? null,
    hasResolvableHostedReviewPushTargetLink: hasResolvableReviewPushTargetLink
  })
  const remoteStatusForActions: typeof remoteStatus = useMemo(
    () =>
      resolveHostedReviewActionUpstreamStatus({
        hasHostedReviewLink,
        hasResolvableHostedReviewPushTargetLink: hasResolvableReviewPushTargetLink,
        hostedReviewState: hostedReviewStateForActions,
        isHostedReviewStateLoading,
        canUseHostedReviewPushTarget,
        upstreamStatus: remoteStatus
      }),
    [
      canUseHostedReviewPushTarget,
      hasHostedReviewLink,
      hasResolvableReviewPushTargetLink,
      hostedReviewStateForActions,
      isHostedReviewStateLoading,
      remoteStatus
    ]
  )
  useEffect(() => {
    if (
      !isBranchVisible ||
      !activeRepo ||
      isFolder ||
      !branchName ||
      branchName === 'HEAD' ||
      !activeWorktreeId
    ) {
      return
    }
    // Why: fetch review immediately on branch change; carry a known PR number because branch lookup is lossy for fork/deleted-head PRs.
    void fetchHostedReviewForBranch(activeRepo.path, branchName, {
      repoId: activeRepo.id,
      linkedGitHubPR,
      fallbackGitHubPR: fallbackGitHubPRNumber,
      linkedGitLabMR,
      linkedBitbucketPR,
      linkedAzureDevOpsPR,
      linkedGiteaPR,
      staleWhileRevalidate: true,
      // Why: scoped to the active worktree, so it earns the host's fast
      // re-check tier instead of the O(N) card pacing (#11532).
      active: true
    })
    // Why: keep the GitHub cache refresh behind the coordinator so Source Control doesn't bypass pacing.
    enqueueGitHubPRRefresh(activeWorktreeId, 'swr', 30)
  }, [
    activeRepo,
    activeWorktreeId,
    branchName,
    enqueueGitHubPRRefresh,
    fetchHostedReviewForBranch,
    isBranchVisible,
    isFolder,
    linkedGitHubPR,
    fallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR
  ])

  // Why: eligibility is recomputed later to pause refetches during an in-flight PR flow, since AI gen's fetch+rebase would flip canCreate off and cancel generation.

  const {
    grouped,
    fileFilterState,
    normalizedFilter,
    isGitHistoryVisible,
    filteredGrouped,
    displaySections,
    unfilteredDisplaySectionsById,
    filteredBranchEntries,
    visibleTreeRowsBySection,
    visibleListRowsBySection,
    visibleBranchTreeRows,
    visibleSelectionEntries
  } = useSourceControlFileProjection({
    entries,
    branchEntries,
    filterQuery,
    sourceControlGroupOrder,
    activeWorktreeId,
    worktreePath,
    isFolder,
    collapsedTreeDirs,
    expandedSubmoduleKeys,
    submoduleStatusByKey,
    sourceControlViewMode,
    collapsedSections
  })
  const { gitHistoryState, refreshGitHistory, refreshGitHistoryRef } = useSourceControlGitHistory({
    activeRepoSettings,
    activeWorktreeId,
    worktreePath,
    compareBaseRef,
    isFolder,
    isBranchVisible,
    isGitHistoryExpanded,
    isGitHistoryVisible,
    worktreeMap
  })

  // Why: modifier-click keeps the current pane intact by opening the file in a fresh split to the right.
  const { resolveSplitTargetGroupId, activeOpenRowKeys, handleOpenDiff, openCommittedDiff } =
    useSourceControlRowOpening({
      isMac,
      activeWorktreeId,
      worktreePath,
      visibleSelectionEntries,
      branchSummary
    })

  const { selectedKeys, handleSelect, handleContextMenu, clearSelection } =
    useSourceControlSelection({
      flatEntries: visibleSelectionEntries,
      onOpenDiff: handleOpenDiff,
      shouldOpenAsSplit: (event) => isSourceControlSplitOpenModifier(event, isMac),
      containerRef: sourceControlRef
    })

  // clear selection on list/tree presentation change
  useEffect(() => {
    clearSelection()
  }, [sourceControlViewMode, clearSelection])

  const handleToggleSourceControlViewMode = useCallback(() => {
    if (!settings) {
      return
    }
    updateSettings({
      sourceControlViewMode: getNextSourceControlViewMode(sourceControlViewMode)
    })
  }, [settings, sourceControlViewMode, updateSettings])

  // Clear selection on worktree or tab change
  useEffect(() => {
    clearSelection()
  }, [activeWorktreeId, rightSidebarTab, clearSelection])

  const flatEntriesByKey = useMemo(
    () => new Map(visibleSelectionEntries.map((entry) => [entry.key, entry])),
    [visibleSelectionEntries]
  )
  const {
    isExecutingBulk,
    setIsExecutingBulk,
    bulkStagePaths,
    bulkUnstagePaths,
    selectedKeySet,
    handleBulkStage,
    handleBulkUnstage,
    handleStageAllPaths,
    handleUnstagePaths,
    handleStageAllPrimary
  } = useSourceControlBulkActions({
    selectedKeys,
    flatEntriesByKey,
    activeRepoSettings,
    activeWorktreeId,
    worktreePath,
    grouped,
    clearSelection,
    refreshActiveGitStatusAfterMutation
  })
  const unresolvedConflicts = useMemo(
    () => entries.filter((entry) => entry.conflictStatus === 'unresolved' && entry.conflictKind),
    [entries]
  )
  const unresolvedConflictReviewEntries = useMemo(
    () =>
      unresolvedConflicts.map((entry) => ({
        path: entry.path,
        conflictKind: entry.conflictKind!
      })),
    [unresolvedConflicts]
  )
  const pushRecovery = useMemo(
    () =>
      deriveSourceControlPushRecovery({
        actionError: remoteActionError,
        currentBranchName: branchName || null,
        currentSequence: activeRemoteActionSequence
      }),
    [activeRemoteActionSequence, branchName, remoteActionError]
  )
  const {
    sourceControlAiDiscoveryHostKey,
    sourceControlAiActionsVisible,
    resolvedCommitMessageAi,
    resolvedPrCreationDefaults,
    resolveConflictsComposerOpen,
    setResolveConflictsComposerOpen,
    commitGenerationDialogOpen,
    setCommitGenerationDialogOpen,
    pullRequestGenerationDialogOpen,
    setPullRequestGenerationDialogOpen,
    openCommitGenerationDialog,
    openPullRequestGenerationDialog,
    isLaunchingCommitFailureAgent,
    isLaunchingPushFailureAgent,
    resolveConflictsPrompt,
    commitFailureRecoveryPrompt,
    getLaunchActionRecipe,
    saveLaunchActionDefault,
    handleResolveConflictsWithAI,
    handleFixCommitFailureWithAI,
    handleFixPushFailureWithAI,
    handleSaveCommitMessageGenerationDefaults,
    handleSavePullRequestGenerationDefaults,
    openSourceControlAiSettings
  } = useSourceControlAi({
    settings: activeRepoSettings,
    activeRepo: activeRepo ?? null,
    activeWorktreeId,
    activeConnectionId,
    activeGroupId,
    activeSourceControlLaunchPlatform,
    conflictOperation,
    unresolvedConflicts,
    stagedEntries: grouped.staged,
    worktreePath,
    commitMessage,
    commitError,
    pushRecoveryPrompt: pushRecovery?.prompt ?? null,
    updateSettings,
    updateRepo,
    openSettingsTarget,
    openSettingsPage
  })

  useEffect(() => {
    if (sourceControlAiActionsVisible) {
      return
    }
    setResolveConflictsComposerOpen(false)
    setCommitGenerationDialogOpen(false)
    setPullRequestGenerationDialogOpen(false)
  }, [
    setCommitGenerationDialogOpen,
    setPullRequestGenerationDialogOpen,
    setResolveConflictsComposerOpen,
    sourceControlAiActionsVisible
  ])

  // Why: prune per-worktree state for removed worktrees so a reused ID doesn't inherit stale state (e.g. a stuck commitInFlightRef disabling Commit).
  useEffect(() => {
    const pruneRecord = <T,>(prev: Record<string, T>): Record<string, T> => {
      let changed = false
      const next: Record<string, T> = {}
      for (const key of Object.keys(prev)) {
        if (worktreeMap.has(key)) {
          next[key] = prev[key]
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    }
    updateCommitDrafts((prev) => pruneRecord(prev))
    commitErrorsRef.current = pruneRecord(commitErrorsRef.current)
    setCommitErrors((prev) => pruneRecord(prev))
    setRemoteActionErrors((prev) => pruneRecord(prev))
    setCommitInFlightByWorktree((prev) => pruneRecord(prev))
    setAbortOperationInFlightByWorktree((prev) => pruneRecord(prev))
    setGenerateInFlightByWorktree((prev) => pruneRecord(prev))
    setGenerateErrors((prev) => pruneRecord(prev))
    setCreatePrIntentInFlightByWorktree((prev) => pruneRecord(prev))
    setCreatePrIntentNotices((prev) => pruneRecord(prev))
    // Refs don't need setState — mutate in place to drop stale keys.
    for (const key of Object.keys(commitInFlightRef.current)) {
      if (!worktreeMap.has(key)) {
        delete commitInFlightRef.current[key]
      }
    }
    for (const key of Object.keys(remoteActionErrorSequenceByWorktreeRef.current)) {
      if (!worktreeMap.has(key)) {
        delete remoteActionErrorSequenceByWorktreeRef.current[key]
      }
    }
    for (const key of Object.keys(generateInFlightRef.current)) {
      if (!worktreeMap.has(key)) {
        delete generateInFlightRef.current[key]
      }
    }
    for (const key of Object.keys(createPrIntentInFlightRef.current)) {
      if (!worktreeMap.has(key)) {
        delete createPrIntentInFlightRef.current[key]
        delete createPrIntentRunTokenRef.current[key]
      }
    }
  }, [updateCommitDrafts, worktreeMap])

  useEffect(() => {
    saveSessionCommitDrafts(commitDrafts)
  }, [commitDrafts])

  useEffect(() => {
    // Why: conflicts are often resolved in a terminal; clear the stale failure banner once git status sees the operation end.
    const previousConflictOperations = previousConflictOperationsRef.current
    setRemoteActionErrors((prev) =>
      clearRemoteActionErrorsForCompletedConflictOperations({
        remoteActionErrors: prev,
        previousConflictOperations,
        currentConflictOperations: conflictOperationsByWorktree
      })
    )
    previousConflictOperationsRef.current = conflictOperationsByWorktree
  }, [conflictOperationsByWorktree])

  // Why: reset worktree-specific state manually instead of key-remounting on switch (which caused a Windows IPC storm).
  useEffect(() => {
    setFilterExpanded(false)
    setCollapsedSections(createDefaultCollapsedSections())
    setCollapsedTreeDirs(new Set())
    setBaseRefDialogOpen(false)
    setPendingDiffCommentsClear(null)
    setIsClearingDiffComments(false)
    // Why: don't reset defaultBaseRef here — it's repo-scoped (resolved on activeRepo change); resetting would clobber non-main defaults.
    setFilterQuery('')
    // Why: don't reset commit-in-flight state — it's per-worktree; resetting would re-enable Commit for an incoming worktree mid-commit.
  }, [activeWorktreeId])

  // Why: returns true on success so compound actions can skip the follow-up remote op when the commit failed.
  const handleCommit = useCallback(
    async (
      messageOverride?: string,
      options?: {
        skipStagedSnapshotCheck?: boolean
        skipActiveConflictCheck?: boolean
        target?: SourceControlOperationTarget
      }
    ): Promise<boolean> => {
      const target =
        options?.target ??
        (activeWorktreeId && worktreePath
          ? {
              settings: activeRepoSettings,
              worktreeId: activeWorktreeId,
              worktreePath,
              connectionId: getConnectionId(activeWorktreeId) ?? undefined,
              pushTarget: activeWorktree?.pushTarget
            }
          : null)
      if (!target) {
        return false
      }
      const message = (messageOverride ?? commitMessage).trim()
      if (
        !message ||
        (!options?.skipStagedSnapshotCheck && grouped.staged.length === 0) ||
        (!options?.skipActiveConflictCheck && unresolvedConflicts.length > 0)
      ) {
        return false
      }

      if (commitInFlightRef.current[target.worktreeId]) {
        return false
      }
      commitInFlightRef.current[target.worktreeId] = true

      setCommitInFlightByWorktree((prev) => ({ ...prev, [target.worktreeId]: true }))
      setCommitErrorForWorktree(target.worktreeId, null)
      try {
        const commitResult = await commitRuntimeGit(
          {
            // Why: route the commit by the repo OWNER host, not the focused runtime.
            settings: target.settings,
            worktreeId: target.worktreeId,
            worktreePath: target.worktreePath,
            connectionId: target.connectionId
          },
          message
        )
        if (!commitResult.success) {
          setCommitErrorForWorktree(target.worktreeId, commitResult.error ?? 'Commit failed')
          return false
        }

        // Why: textarea stays editable during commit, so only clear the draft when it still matches what we committed — else we'd discard edits typed after Commit.
        updateCommitDrafts((prev) => {
          const current = prev[target.worktreeId]
          if (current !== undefined && current.trim() !== message) {
            // User typed more after submit — preserve their in-progress edits.
            return prev
          }
          return writeCommitDraftForWorktree(prev, target.worktreeId, '')
        })
        setCommitErrorForWorktree(target.worktreeId, null)
        if (!options?.target) {
          void refreshActiveGitStatusAfterMutation()
        }
        // Why: flip branchSummary to 'loading' synchronously so "No changes on this branch" doesn't flash before the branchCompare poll lands the commit.
        if (!options?.target && compareBaseRef) {
          beginGitBranchCompareRequest(
            target.worktreeId,
            `${target.worktreeId}:${compareBaseRef}:${Date.now()}:post-commit`,
            compareBaseRef
          )
        }
        if (!options?.target) {
          void refreshBranchCompareRef.current()
          void refreshGitHistoryRef.current()
        }
        return true
      } catch (error) {
        setCommitErrorForWorktree(
          target.worktreeId,
          error instanceof Error ? error.message : 'Commit failed'
        )
        return false
      } finally {
        setCommitInFlightByWorktree((prev) => ({ ...prev, [target.worktreeId]: false }))
        commitInFlightRef.current[target.worktreeId] = false
      }
    },
    [
      activeRepoSettings,
      activeWorktree?.pushTarget,
      activeWorktreeId,
      beginGitBranchCompareRequest,
      commitMessage,
      compareBaseRef,
      grouped.staged.length,
      refreshActiveGitStatusAfterMutation,
      refreshBranchCompareRef,
      refreshGitHistoryRef,
      setCommitErrorForWorktree,
      updateCommitDrafts,
      unresolvedConflicts.length,
      worktreePath
    ]
  )

  const handleGenerate = useCallback(
    async (overrides?: RuntimeGenerateCommitMessageOverrides): Promise<void> => {
      if (!activeWorktreeId || !worktreePath || !activeCommitMessageGenerationKey) {
        return
      }
      if (generateInFlightRef.current[activeWorktreeId]) {
        return
      }
      if (!overrides?.sourceControlAiResolvedParams && resolvedCommitMessageAi?.ok !== true) {
        return
      }

      if (
        !overrides?.sourceControlAiResolvedParams &&
        resolvedCommitMessageAi?.ok === true &&
        isCustomAgentId(resolvedCommitMessageAi.value.params.agentId)
      ) {
        const command = resolvedCommitMessageAi.value.params.customAgentCommand?.trim() ?? ''
        if (!command) {
          setGenerateErrors((prev) => ({
            ...prev,
            [activeWorktreeId]:
              'Custom command is empty. Add one in Settings -> Git -> Source Control AI.'
          }))
          return
        }
      }

      generateInFlightRef.current[activeWorktreeId] = true
      const requestId = allocateCommitMessageGenerationRequestId()
      const connectionId = getConnectionId(activeWorktreeId) ?? undefined
      setCommitMessageGenerationRecord(
        activeCommitMessageGenerationKey,
        createRunningCommitMessageGenerationRecord({
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId,
          requestId,
          runtimeTargetSettings: activeRepoSettings
        })
      )
      setGenerateInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: true }))
      setGenerateErrors((prev) => ({ ...prev, [activeWorktreeId]: null }))
      try {
        const result = await generateRuntimeCommitMessage(
          {
            // Why: route generation by the repo OWNER host, not the focused runtime.
            settings: activeRepoSettings,
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId
          },
          overrides
        )

        if (!result.success) {
          // Why: cancellation is a deliberate user action, not a failure to surface.
          if (result.canceled) {
            setGenerateErrors((prev) => ({ ...prev, [activeWorktreeId]: null }))
            updateCommitMessageGenerationRecord(activeCommitMessageGenerationKey, (record) =>
              resolveCommitMessageGenerationFailure({
                record,
                requestId,
                canceled: true,
                error: null
              })
            )
            return
          }
          setGenerateErrors((prev) => ({
            ...prev,
            [activeWorktreeId]: result.error
          }))
          updateCommitMessageGenerationRecord(activeCommitMessageGenerationKey, (record) =>
            resolveCommitMessageGenerationFailure({
              record,
              requestId,
              error: result.error
            })
          )
          return
        }

        updateCommitMessageGenerationRecord(activeCommitMessageGenerationKey, (record) =>
          resolveCommitMessageGenerationSuccess({
            record,
            requestId,
            message: result.message
          })
        )
        // Why: race protection — drop the generated message if the user typed into the textarea while the agent ran, rather than overwrite their edits.
        updateCommitDrafts((prev) => {
          const current = prev[activeWorktreeId]
          if (current && current.length > 0) {
            return prev
          }
          return writeCommitDraftForWorktree(prev, activeWorktreeId, result.message)
        })
        useAppStore.getState().recordFeatureInteraction('ai-commit-generation')
        setGenerateErrors((prev) => ({ ...prev, [activeWorktreeId]: null }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate commit message'
        setGenerateErrors((prev) => ({
          ...prev,
          [activeWorktreeId]: message
        }))
        updateCommitMessageGenerationRecord(activeCommitMessageGenerationKey, (record) =>
          resolveCommitMessageGenerationFailure({
            record,
            requestId,
            error: message
          })
        )
      } finally {
        setGenerateInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: false }))
        generateInFlightRef.current[activeWorktreeId] = false
      }
    },
    [
      activeCommitMessageGenerationKey,
      activeRepoSettings,
      activeWorktreeId,
      allocateCommitMessageGenerationRequestId,
      resolvedCommitMessageAi,
      setCommitMessageGenerationRecord,
      updateCommitDrafts,
      updateCommitMessageGenerationRecord,
      worktreePath
    ]
  )

  const handleGenerateCommitMessageClick = useCallback((): void => {
    if (!sourceControlAiActionsVisible) {
      return
    }
    if (
      hasConfiguredCommitMessageGenerationDefaults({ settings, repo: activeRepo ?? null }) &&
      resolvedCommitMessageAi?.ok
    ) {
      void handleGenerate({ sourceControlAiResolvedParams: resolvedCommitMessageAi.value.params })
      return
    }
    openCommitGenerationDialog()
  }, [
    activeRepo,
    handleGenerate,
    openCommitGenerationDialog,
    resolvedCommitMessageAi,
    settings,
    sourceControlAiActionsVisible
  ])

  const generateCommitMessageForCreatePrIntent = useCallback(
    async (
      token: CreatePrIntentRunToken
    ): Promise<{
      ok: boolean
      message?: string
      reason?: 'settings' | 'failed' | 'canceled'
    }> => {
      if (
        !hasConfiguredCommitMessageGenerationDefaults({ settings, repo: activeRepo ?? null }) ||
        resolvedCommitMessageAi?.ok !== true
      ) {
        return { ok: false, reason: 'settings' }
      }
      if (isCustomAgentId(resolvedCommitMessageAi.value.params.agentId)) {
        const command = resolvedCommitMessageAi.value.params.customAgentCommand?.trim() ?? ''
        if (!command) {
          return { ok: false, reason: 'settings' }
        }
      }
      const target = getCreatePrIntentOperationTarget(token)
      if (generateInFlightRef.current[target.worktreeId]) {
        return { ok: false, reason: 'failed' }
      }

      generateInFlightRef.current[target.worktreeId] = true
      setGenerateInFlightByWorktree((prev) => ({ ...prev, [target.worktreeId]: true }))
      setGenerateErrors((prev) => ({ ...prev, [target.worktreeId]: null }))
      try {
        const result = await generateRuntimeCommitMessage(target, {
          sourceControlAiResolvedParams: resolvedCommitMessageAi.value.params
        })
        if (!result.success) {
          if (!result.canceled) {
            setGenerateErrors((prev) => ({ ...prev, [target.worktreeId]: result.error }))
          }
          return { ok: false, reason: result.canceled ? 'canceled' : 'failed' }
        }
        useAppStore.getState().recordFeatureInteraction('ai-commit-generation')
        setGenerateErrors((prev) => ({ ...prev, [target.worktreeId]: null }))
        return { ok: true, message: result.message }
      } catch (error) {
        setGenerateErrors((prev) => ({
          ...prev,
          [target.worktreeId]:
            error instanceof Error ? error.message : 'Failed to generate commit message'
        }))
        return { ok: false, reason: 'failed' }
      } finally {
        setGenerateInFlightByWorktree((prev) => ({ ...prev, [target.worktreeId]: false }))
        generateInFlightRef.current[target.worktreeId] = false
      }
    },
    [activeRepo, getCreatePrIntentOperationTarget, resolvedCommitMessageAi, settings]
  )

  const handleCancelGenerate = useCallback((): void => {
    if (!activeWorktreeId || !worktreePath || !activeCommitMessageGenerationKey) {
      return
    }
    if (!generateInFlightRef.current[activeWorktreeId]) {
      return
    }
    updateCommitMessageGenerationRecord(activeCommitMessageGenerationKey, (record) =>
      resolveCommitMessageGenerationCancel(record)
    )
    const connectionId = getConnectionId(activeWorktreeId) ?? undefined
    // Why: fire-and-forget; the in-flight promise resolves {canceled: true} where the spinner clears, so awaiting would just delay UI feedback.
    void cancelRuntimeGenerateCommitMessage({
      // Why: route the cancel by the repo OWNER host, not the focused runtime.
      settings: activeRepoSettings,
      worktreeId: activeWorktreeId,
      worktreePath,
      connectionId
    })
  }, [
    activeCommitMessageGenerationKey,
    activeRepoSettings,
    activeWorktreeId,
    updateCommitMessageGenerationRecord,
    worktreePath
  ])

  // Why: single dispatcher for remote-only actions; error-swallow lives here since store slices already surface actionable toasts.
  // Why: statuses distinguish real failures from supersession and no-ops; collapsing to { ok: false } made Create PR treat supersession as a destructive failure.
  type RunRemoteActionResult =
    | { status: 'ok' }
    | { status: 'failed'; error: SourceControlActionError }
    | { status: 'superseded' }
    | { status: 'skipped' }

  const runRemoteAction = useCallback(
    async (
      kind:
        | 'push'
        | 'force_push'
        | 'pull'
        | 'fast_forward'
        | 'sync'
        | 'fetch'
        | 'publish'
        | 'rebase',
      options?: {
        target?: SourceControlOperationTarget
        baseRef?: string | null
      }
    ): Promise<RunRemoteActionResult> => {
      const target =
        options?.target ??
        (activeWorktreeId && worktreePath
          ? {
              settings: activeRepoSettings,
              worktreeId: activeWorktreeId,
              worktreePath,
              connectionId: getConnectionId(activeWorktreeId) ?? undefined,
              pushTarget: activeWorktree?.pushTarget
            }
          : null)
      if (!target) {
        return { status: 'skipped' }
      }
      const sequence = (remoteActionErrorSequenceByWorktreeRef.current[target.worktreeId] ?? 0) + 1
      remoteActionErrorSequenceByWorktreeRef.current[target.worktreeId] = sequence
      const targetIsActiveWorktree = target.worktreeId === activeWorktreeId
      const recoveryEntrySnapshot = captureSourceControlRecoveryEntrySnapshot(
        targetIsActiveWorktree
          ? ([
              ...grouped.staged,
              ...grouped.unstaged,
              ...grouped.untracked
            ] satisfies SourceControlRecoveryStatusEntry[])
          : []
      )
      const failureBranchName = targetIsActiveWorktree ? branchName || null : null
      setRemoteActionErrors((prev) => ({ ...prev, [target.worktreeId]: null }))
      try {
        if (kind === 'publish') {
          await pushBranch(
            target.worktreeId,
            target.worktreePath,
            true,
            target.connectionId,
            target.pushTarget,
            { runtimeTargetSettings: target.settings }
          )
          return { status: 'ok' }
        }
        if (kind === 'push') {
          // Why: kind 'push' must stay a regular push; auto-upgrading made the always-enabled dropdown Push row silently force-push against its tooltip.
          await pushBranch(
            target.worktreeId,
            target.worktreePath,
            false,
            target.connectionId,
            target.pushTarget,
            { runtimeTargetSettings: target.settings }
          )
          return { status: 'ok' }
        }
        if (kind === 'force_push') {
          await pushBranch(
            target.worktreeId,
            target.worktreePath,
            false,
            target.connectionId,
            target.pushTarget,
            { forceWithLease: true, runtimeTargetSettings: target.settings }
          )
          return { status: 'ok' }
        }
        if (kind === 'pull') {
          await pullBranch(
            target.worktreeId,
            target.worktreePath,
            target.connectionId,
            target.pushTarget,
            {
              runtimeTargetSettings: target.settings
            }
          )
          return { status: 'ok' }
        }
        if (kind === 'fast_forward') {
          await fastForwardBranch(
            target.worktreeId,
            target.worktreePath,
            target.connectionId,
            target.pushTarget,
            { runtimeTargetSettings: target.settings }
          )
          return { status: 'ok' }
        }
        if (kind === 'fetch') {
          await fetchBranch(
            target.worktreeId,
            target.worktreePath,
            target.connectionId,
            target.pushTarget,
            {
              runtimeTargetSettings: target.settings
            }
          )
          return { status: 'ok' }
        }
        if (kind === 'rebase') {
          const baseRef = options?.baseRef ?? effectiveBaseRef
          if (!baseRef) {
            return { status: 'skipped' }
          }
          await rebaseFromBase(
            target.worktreeId,
            target.worktreePath,
            baseRef,
            target.connectionId,
            target.pushTarget,
            { runtimeTargetSettings: target.settings }
          )
          return { status: 'ok' }
        }
        await syncBranch(
          target.worktreeId,
          target.worktreePath,
          target.connectionId,
          target.pushTarget,
          {
            runtimeTargetSettings: target.settings
          }
        )
        if (remoteActionErrorSequenceByWorktreeRef.current[target.worktreeId] === sequence) {
          setRemoteActionErrors((prev) => ({ ...prev, [target.worktreeId]: null }))
        }
        return { status: 'ok' }
      } catch (error) {
        // Why: editor-slice actions own the failure toast; keep the latest failure inline too since dropdown-only actions like Fetch look silent once the menu closes.
        if (remoteActionErrorSequenceByWorktreeRef.current[target.worktreeId] !== sequence) {
          return { status: 'superseded' }
        }
        const actionError: SourceControlActionError = {
          kind,
          message: resolveRemoteActionError(kind, error),
          rawError: error instanceof Error ? error.message : String(error),
          syncPushStage: kind === 'sync' ? isSyncPushStageError(error) : false,
          branchName: failureBranchName,
          worktreePath: target.worktreePath,
          entriesSnapshot: recoveryEntrySnapshot.entries,
          entriesSnapshotTotalCount: recoveryEntrySnapshot.totalCount,
          sequence
        }
        setRemoteActionErrors((prev) => ({ ...prev, [target.worktreeId]: actionError }))
        return { status: 'failed', error: actionError }
      } finally {
        if (!options?.target) {
          refreshSourceControlAfterRemoteAction({
            refreshGitStatus: refreshActiveGitStatusAfterMutation,
            refreshBranchCompare: refreshBranchCompareRef.current,
            refreshGitHistory: refreshGitHistoryRef.current
          })
        }
      }
    },
    [
      activeRepoSettings,
      activeWorktree?.pushTarget,
      activeWorktreeId,
      branchName,
      fetchBranch,
      fastForwardBranch,
      effectiveBaseRef,
      grouped.staged,
      grouped.unstaged,
      grouped.untracked,
      pullBranch,
      pushBranch,
      rebaseFromBase,
      refreshActiveGitStatusAfterMutation,
      refreshBranchCompareRef,
      refreshGitHistoryRef,
      syncBranch,
      worktreePath
    ]
  )

  const handleAbortOperation = useCallback(
    async (requestedOperation: AbortConflictOperation): Promise<void> => {
      if (
        !activeWorktreeId ||
        !worktreePath ||
        conflictOperation !== requestedOperation ||
        isAbortingOperation
      ) {
        return
      }

      const isRebase = requestedOperation === 'rebase'
      const label = isRebase ? 'rebase' : 'merge'
      const title = isRebase ? 'Abort rebase?' : 'Abort merge?'
      const description = isRebase
        ? 'This cancels the rebase in progress and can discard conflict resolutions made during this rebase.'
        : 'This cancels the merge in progress and can discard conflict resolutions made during this merge.'
      const confirmed = await confirmAction({
        title,
        description,
        confirmLabel: `Abort ${label}`,
        confirmVariant: 'destructive'
      })
      if (!confirmed) {
        return
      }

      const connectionId = getConnectionId(activeWorktreeId) ?? undefined
      setAbortOperationInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: true }))
      setRemoteActionErrors((prev) => ({ ...prev, [activeWorktreeId]: null }))
      try {
        const context = {
          // Why: route the abort by the repo OWNER host, not the focused runtime.
          settings: activeRepoSettings,
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId
        }
        const abortGitOperation = isRebase ? abortRuntimeGitRebase : abortRuntimeGitMerge
        await abortGitOperation(context)
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to abort ${label}`
        toast.error(
          translate(
            'auto.components.right.sidebar.SourceControl.f99560ab29',
            'Abort {{value0}} failed',
            { value0: label }
          ),
          { description: message }
        )
        setRemoteActionErrors((prev) => ({
          ...prev,
          [activeWorktreeId]: {
            kind: isRebase ? 'abort_rebase' : 'abort_merge',
            message,
            rawError: message
          }
        }))
      } finally {
        setAbortOperationInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: false }))
        refreshSourceControlAfterRemoteAction({
          refreshGitStatus: refreshActiveGitStatusAfterMutation,
          refreshBranchCompare: refreshBranchCompareRef.current,
          refreshGitHistory: refreshGitHistoryRef.current
        })
      }
    },
    [
      activeRepoSettings,
      activeWorktreeId,
      confirmAction,
      conflictOperation,
      isAbortingOperation,
      refreshActiveGitStatusAfterMutation,
      refreshBranchCompareRef,
      refreshGitHistoryRef,
      worktreePath
    ]
  )

  const handleAbortMerge = useCallback(async (): Promise<void> => {
    await handleAbortOperation('merge')
  }, [handleAbortOperation])

  const handleAbortRebase = useCallback(async (): Promise<void> => {
    await handleAbortOperation('rebase')
  }, [handleAbortOperation])

  const handleAbortOperationForConflict = useCallback(
    (operation: GitConflictOperation): void => {
      if (operation === 'merge') {
        void handleAbortMerge()
        return
      }
      if (operation === 'rebase') {
        void handleAbortRebase()
      }
    },
    [handleAbortMerge, handleAbortRebase]
  )

  // Why: commit first and run the follow-up remote op only if handleCommit succeeded, so we never push a commit the user didn't land.
  const runCompoundCommitAction = useCallback(
    async (remoteKind: 'push' | 'sync'): Promise<void> => {
      const ok = await handleCommit()
      if (!ok) {
        return
      }
      // Why: "Commit & Force Push" maps to remoteKind 'push', so route to force_push when the upstream shape requires lease force (kind 'push' no longer auto-upgrades).
      if (
        remoteKind === 'push' &&
        shouldForcePushWithLeaseForUpstream(remoteStatusForActions ?? remoteStatus)
      ) {
        await runRemoteAction('force_push')
        return
      }
      await runRemoteAction(remoteKind)
    },
    [handleCommit, remoteStatus, remoteStatusForActions, runRemoteAction]
  )

  const handlePullRequestCreated = useCallback(
    async (result: CreatedHostedReview, context?: HostedReviewCreatedContext): Promise<void> => {
      const repoPath = context?.repoPath ?? activeRepo?.path
      const repoId = context?.repoId ?? activeRepo?.id
      const branch = context?.branch ?? branchName
      const worktreeId = context?.worktreeId ?? activeWorktreeId ?? null
      const openChecks = context?.openChecks ?? true
      if (!repoPath || !repoId || !branch) {
        return
      }
      const copy = localizedHostedReviewCopy(
        resolveSupportedHostedReviewCopyProvider(result.provider)
      )
      if (openChecks) {
        setRightSidebarOpen(true)
        setRightSidebarTab('checks')
      }
      try {
        const createdLink = resolveCreatedHostedReviewLink(result.provider, result.number)
        if (worktreeId && result.provider !== 'unsupported') {
          await updateWorktreeMeta(worktreeId, createdLink.worktree)
        }
        const linkedReviewNumbers = {
          linkedGitHubPR,
          fallbackGitHubPR: fallbackGitHubPRNumber,
          linkedGitLabMR,
          linkedBitbucketPR,
          linkedAzureDevOpsPR,
          linkedGiteaPR,
          ...createdLink.lookup
        }
        if (result.provider === 'gitlab') {
          await fetchHostedReviewForBranch(repoPath, branch, {
            force: true,
            repoId,
            ...linkedReviewNumbers
          })
          return
        }
        if (result.provider !== 'github') {
          await fetchHostedReviewForBranch(repoPath, branch, {
            force: true,
            repoId,
            ...linkedReviewNumbers
          })
          return
        }
        await Promise.all([
          fetchHostedReviewForBranch(repoPath, branch, {
            force: true,
            repoId,
            ...linkedReviewNumbers
          }),
          fetchPRForBranch(repoPath, branch, {
            force: true,
            repoId,
            worktreeId: worktreeId ?? undefined,
            linkedPRNumber: result.number
          })
        ])
      } catch {
        toast.warning(
          translate(
            'auto.components.right.sidebar.SourceControl.0453ca3a9a',
            '{{value0}} created, but Orca could not refresh it yet.',
            { value0: copy.titleLabel }
          ),
          {
            action: {
              label: translate(
                'auto.components.right.sidebar.SourceControl.812cb992ee',
                'Open on {{value0}}',
                { value0: copy.providerName }
              ),
              onClick: () => window.api.shell.openUrl(result.url)
            }
          }
        )
      }
    },
    [
      activeRepo,
      activeWorktreeId,
      branchName,
      fallbackGitHubPRNumber,
      fetchHostedReviewForBranch,
      fetchPRForBranch,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGiteaPR,
      linkedGitHubPR,
      linkedGitLabMR,
      setRightSidebarOpen,
      setRightSidebarTab,
      updateWorktreeMeta
    ]
  )

  const openHostedReviewInChecks = useCallback(() => {
    setRightSidebarOpen(true)
    setRightSidebarTab('checks')
  }, [setRightSidebarOpen, setRightSidebarTab])

  const handleBranchChangedByPullRequestGeneration = useCallback(async (): Promise<void> => {
    // Why: AI PR detail generation may rebase before summarizing, so refresh status if HEAD moved before the user submits the draft.
    await refreshActiveGitStatusAfterMutation()
  }, [refreshActiveGitStatusAfterMutation])

  const handleGeneratePullRequestFieldsForActive = useCallback(
    async (
      fields: PullRequestGenerationFields,
      fieldRevisions: PullRequestFieldRevisions,
      overrides?: RuntimeGeneratePullRequestFieldsOverrides
    ): Promise<void> => {
      if (!activeRepo || !activePullRequestGenerationKey || !worktreePath || !branchName) {
        return
      }
      const generationKey = activePullRequestGenerationKey
      if (
        useAppStore.getState().pullRequestGenerationRecords[generationKey]?.status === 'running'
      ) {
        return
      }
      const requestId = allocatePullRequestGenerationRequestId()
      const context: PullRequestGenerationContext = {
        worktreeId: activeWorktreeId,
        worktreePath,
        connectionId: getConnectionId(activeWorktreeId) ?? undefined,
        requestId,
        repoId: activeRepo.id,
        branch: branchName,
        runtimeTargetSettings: activeRepoSettings
      }
      const seed = { ...fields }
      // Why: SourceControl can unmount on tab switches; the persisted record lets the PR composer resume on return.
      setPullRequestGenerationRecord(
        generationKey,
        createRunningPullRequestGenerationRecord(context, seed, fieldRevisions)
      )

      try {
        const result = await generateRuntimePullRequestFields(
          {
            // Why: route generation by the repo OWNER host, not the focused runtime.
            settings: context.runtimeTargetSettings,
            worktreeId: context.worktreeId,
            worktreePath: context.worktreePath,
            connectionId: context.connectionId
          },
          {
            base: stripBaseRef(seed.base.trim()),
            title: seed.title,
            body: seed.body,
            draft: seed.draft,
            provider: hostedReviewCreateProvider,
            useTemplate: resolvedPrCreationDefaults.useTemplate
          },
          overrides
        )
        if (result.branchChangedByPreparation) {
          await refreshGitStatusAfterPullRequestGeneration(context)
        }
        if (result.success) {
          useAppStore.getState().recordFeatureInteraction('ai-pr-generation')
        }
        updatePullRequestGenerationRecord(generationKey, (record) => {
          if (!result.success) {
            return resolvePullRequestGenerationFailure({
              record,
              requestId,
              canceled: result.canceled,
              error: result.canceled ? null : result.error
            })
          }
          if (!record) {
            return null
          }
          return resolvePullRequestGenerationSuccess({
            record,
            requestId,
            result: {
              base: stripBaseRef(result.fields.base),
              title: result.fields.title,
              body: result.fields.body,
              draft: result.fields.draft
            }
          })
        })
      } catch (error) {
        updatePullRequestGenerationRecord(generationKey, (record) =>
          resolvePullRequestGenerationFailure({
            record,
            requestId,
            error:
              error instanceof Error ? error.message : 'Failed to generate pull request details'
          })
        )
      }
    },
    [
      activePullRequestGenerationKey,
      activeRepo,
      activeRepoSettings,
      activeWorktreeId,
      allocatePullRequestGenerationRequestId,
      branchName,
      hostedReviewCreateProvider,
      refreshGitStatusAfterPullRequestGeneration,
      resolvedPrCreationDefaults.useTemplate,
      setPullRequestGenerationRecord,
      updatePullRequestGenerationRecord,
      worktreePath
    ]
  )

  const handleCancelGeneratePullRequestFieldsForActive = useCallback((): void => {
    if (!activePullRequestGenerationKey) {
      return
    }
    const record = prGenerationRecords[activePullRequestGenerationKey]
    if (!record || record.status !== 'running') {
      return
    }
    const generationKey = activePullRequestGenerationKey
    updatePullRequestGenerationRecord(generationKey, (current) => {
      if (!current || current.context.requestId !== record.context.requestId) {
        return null
      }
      return resolvePullRequestGenerationCancel(current)
    })
    void cancelRuntimeGeneratePullRequestFields({
      // Why: the user can switch hosts while generation runs; cancel the original request owner, not the focused host.
      settings: record.context.runtimeTargetSettings,
      worktreeId: record.context.worktreeId,
      worktreePath: record.context.worktreePath,
      connectionId: record.context.connectionId
    }).catch((error) => {
      updatePullRequestGenerationRecord(generationKey, (current) => {
        if (!current || current.context.requestId !== record.context.requestId) {
          return null
        }
        return {
          ...current,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to stop pull request generation',
          hydrated: false
        }
      })
    })
  }, [activePullRequestGenerationKey, prGenerationRecords, updatePullRequestGenerationRecord])
  const handlePullRequestGenerationSeedRestored = useCallback((): void => {
    if (!activePullRequestGenerationKey || !activePullRequestGenerationRecord) {
      return
    }
    const requestId = activePullRequestGenerationRecord.context.requestId
    updatePullRequestGenerationRecord(activePullRequestGenerationKey, (record) =>
      markPullRequestGenerationTerminalSeedRestored({
        record,
        requestId
      })
    )
  }, [
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    updatePullRequestGenerationRecord
  ])

  const {
    aiGenerationEnabled: prAiGenerationEnabled,
    base: prBase,
    setBase: setPrBase,
    title: prTitle,
    setTitle: setPrTitle,
    body: prBody,
    setBody: setPrBody,
    draft: prDraft,
    setDraft: setPrDraft,
    stackedCreationSupported: prStackedCreationSupported,
    repoDefaultBaseRef: prRepoDefaultBaseRef,
    baseQuery: prBaseQuery,
    setBaseQuery: setPrBaseQuery,
    baseResults: prBaseResults,
    setBaseResults: setPrBaseResults,
    baseSearchPending: prBaseSearchPending,
    baseSearchError: prBaseSearchError,
    generating: prGenerating,
    generateError: prGenerateError,
    generateDisabled: prGenerateDisabled,
    generateDisabledReason: prGenerateDisabledReason,
    handleGenerate: handleGeneratePullRequestFields,
    handleCancelGenerate: handleCancelGeneratePullRequestFields,
    applyGeneratedFields: applyGeneratedPullRequestFields,
    initializedFromEligibility: pullRequestFieldsInitialized
  } = useCreatePullRequestDialogFields({
    open: hostedReviewCreation?.canCreate === true,
    repoId: activeRepo?.id ?? '',
    worktreeId: activeWorktreeId,
    worktreePath: worktreePath ?? '',
    branch: branchName,
    eligibility: hostedReviewCreation,
    currentBaseRef: effectiveBaseRef,
    repo: activeRepo ?? null,
    settings: activeRepoSettings,
    submitting: isCreatingPr,
    prCreationDefaults: resolvedPrCreationDefaults,
    sourceControlAiActionsVisible,
    onBranchChangedByGeneration: handleBranchChangedByPullRequestGeneration,
    generation: {
      generating: activePullRequestGenerationRecord?.status === 'running',
      generateError: activePullRequestGenerationRecord?.error ?? null,
      seedRestoreKey: activePullRequestGenerationSeedRestoreKey,
      seed: activePullRequestGenerationRecord?.seed ?? null,
      seedFieldRevisions: activePullRequestGenerationRecord?.seedFieldRevisions ?? null,
      onSeedRestored: handlePullRequestGenerationSeedRestored,
      onGenerate: (fields, fieldRevisions, overrides) => {
        void handleGeneratePullRequestFieldsForActive(fields, fieldRevisions, overrides)
      },
      onCancelGenerate: handleCancelGeneratePullRequestFieldsForActive
    }
  })
  const stackParentReview = useHostedReviewStackParent({
    enabled: hostedReviewCreateProvider === 'github' && prStackedCreationSupported,
    repoPath: activeRepo?.path ?? '',
    repoId: activeRepo?.id ?? null,
    base: prBase,
    // Why: the repo default, not eligibility's defaultBaseRef — that one resolves to
    // the worktree's own base, which is exactly the branch a stacked PR targets.
    repoDefaultBase: prRepoDefaultBaseRef,
    head: branchName,
    fetchHostedReviewForBranch
  })

  const handleGeneratePullRequestFieldsClick = useCallback((): void => {
    if (!sourceControlAiActionsVisible) {
      return
    }
    if (
      hasConfiguredSourceControlTextGenerationDefaults({
        actionId: 'pullRequest',
        settings,
        repo: activeRepo ?? null
      })
    ) {
      void handleGeneratePullRequestFields()
      return
    }
    openPullRequestGenerationDialog()
  }, [
    activeRepo,
    handleGeneratePullRequestFields,
    openPullRequestGenerationDialog,
    settings,
    sourceControlAiActionsVisible
  ])

  useEffect(() => {
    // Why: on remount the PR fields hook seeds eligibility defaults in an effect; hydrating before it runs gets overwritten.
    if (
      !activePullRequestGenerationKey ||
      !activePullRequestGenerationRecord ||
      activePullRequestGenerationRecord.status !== 'succeeded' ||
      !activePullRequestGenerationRecord.result ||
      activePullRequestGenerationRecord.hydrated ||
      !pullRequestFieldsInitialized
    ) {
      return
    }
    if (
      !shouldHydratePullRequestGenerationResult({
        record: activePullRequestGenerationRecord
      })
    ) {
      return
    }
    const result = activePullRequestGenerationRecord.result
    applyGeneratedPullRequestFields(result, activePullRequestGenerationRecord.seedFieldRevisions)
    updatePullRequestGenerationRecord(activePullRequestGenerationKey, (record) => {
      if (
        !record ||
        record.context.requestId !== activePullRequestGenerationRecord.context.requestId
      ) {
        return null
      }
      return {
        ...record,
        hydrated: true
      }
    })
  }, [
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    applyGeneratedPullRequestFields,
    pullRequestFieldsInitialized,
    updatePullRequestGenerationRecord
  ])

  useEffect(() => {
    // Why: generation can finish after Source Control unmounts; the store record lets the remounted textarea consume it once.
    if (
      !activeCommitMessageGenerationKey ||
      !activeWorktreeId ||
      !activeCommitMessageGenerationRecord ||
      activeCommitMessageGenerationRecord.status !== 'succeeded' ||
      !activeCommitMessageGenerationRecord.message ||
      activeCommitMessageGenerationRecord.hydrated
    ) {
      return
    }
    updateCommitDrafts((prev) => {
      const current = prev[activeWorktreeId]
      return current && current.length > 0
        ? prev
        : writeCommitDraftForWorktree(
            prev,
            activeWorktreeId,
            activeCommitMessageGenerationRecord.message ?? ''
          )
    })
    updateCommitMessageGenerationRecord(activeCommitMessageGenerationKey, (record) =>
      markCommitMessageGenerationHydrated(record)
    )
  }, [
    activeCommitMessageGenerationKey,
    activeCommitMessageGenerationRecord,
    activeWorktreeId,
    updateCommitDrafts,
    updateCommitMessageGenerationRecord
  ])

  useEffect(() => {
    if (
      !isBranchVisible ||
      !activeRepoId ||
      !activeRepoPath ||
      isFolder ||
      !branchName ||
      !activeWorktreeId
    ) {
      setHostedReviewCreationState(null)
      setHostedReviewCreationRequestState(null)
      return
    }
    // Why: skip refetches while a PR flow is mid-flight — recomputing eligibility then can tear down the composer before the final refresh restores truth.
    if (prGenerating || isCreatingPr || isCreatePrIntentInFlight) {
      setHostedReviewCreationRequestState(null)
      return
    }
    let stale = false
    setHostedReviewCreationRequestState({
      repoId: activeRepoId,
      worktreeId: activeWorktreeId,
      branch: branchName,
      status: 'loading'
    })
    // Why: upstream/status changes can make the previous eligibility unsafe to click while the new preflight resolves.
    setHostedReviewCreationState(null)
    void getHostedReviewCreationEligibility({
      repoPath: activeRepoPath,
      repoId: activeRepoId,
      ...(worktreePath ? { worktreePath } : {}),
      branch: branchName,
      base: effectiveBaseRef ?? null,
      hasUncommittedChanges: hasUncommittedEntries,
      hasUpstream: remoteStatus?.hasUpstream,
      ahead: remoteStatus?.ahead,
      behind: remoteStatus?.behind,
      linkedGitHubPR,
      fallbackGitHubPR: fallbackGitHubPRNumber,
      linkedGitLabMR,
      linkedBitbucketPR,
      linkedAzureDevOpsPR,
      linkedGiteaPR
    })
      .then((result) => {
        if (!stale) {
          setHostedReviewCreationState({
            repoId: activeRepoId,
            worktreeId: activeWorktreeId,
            branch: branchName,
            data: result
          })
          setHostedReviewCreationRequestState(null)
        }
      })
      .catch((error) => {
        console.warn('[SourceControl] hosted review creation eligibility failed', error)
        if (stale) {
          return
        }
        // Why: a failed remote probe can give branch guidance but cannot authorize hosted-review creation.
        const localBlocker = buildLocalBlockerHostedReviewCreationEligibility(
          resolveCurrentHostedReviewCreationProvider(),
          {
            branch: branchName,
            baseRef: effectiveBaseRef,
            hasUncommittedChanges: hasUncommittedEntries,
            hasUpstream: remoteStatus?.hasUpstream,
            ahead: remoteStatus?.ahead,
            behind: remoteStatus?.behind
          }
        )
        if (localBlocker) {
          setHostedReviewCreationState({
            repoId: activeRepoId,
            worktreeId: activeWorktreeId,
            branch: branchName,
            data: localBlocker
          })
          setHostedReviewCreationRequestState(null)
          return
        }
        setHostedReviewCreationState(null)
        setHostedReviewCreationRequestState({
          repoId: activeRepoId,
          worktreeId: activeWorktreeId,
          branch: branchName,
          status: 'failed'
        })
      })
    return () => {
      stale = true
    }
  }, [
    // Why: unrelated repo metadata replacement must not restart a hung probe's timeout.
    activeRepoConnectionId,
    activeRepoExecutionHostId,
    activeRepoId,
    activeRepoPath,
    branchName,
    effectiveBaseRef,
    getHostedReviewCreationEligibility,
    hasUncommittedEntries,
    setHostedReviewCreationRequestState,
    isBranchVisible,
    isCreatingPr,
    isCreatePrIntentInFlight,
    isFolder,
    linkedGitHubPR,
    fallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    prGenerating,
    remoteStatus?.ahead,
    remoteStatus?.behind,
    remoteStatus?.hasUpstream,
    activeWorktreeId,
    worktreePath
  ])

  const handleCreatePullRequest = useCallback(
    async (stacked = false): Promise<void> => {
      if (
        !activeRepo ||
        !activeWorktreeId ||
        !worktreePath ||
        !hostedReviewCreation ||
        prGenerating ||
        createPrInFlightRef.current[activeWorktreeId]
      ) {
        return
      }

      if (!hostedReviewCreation.canCreate) {
        // Why: blocked Create Review clicks are intentional; the inline notice tells the user which prerequisite to clear.
        const message = resolveBlockedCreateReviewNoticeMessage(hostedReviewCreation)
        if (message) {
          setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
            tone: 'destructive',
            message
          })
        }
        return
      }

      const base = stripBaseRef(prBase).trim()
      const title = prTitle.trim()

      if (!title) {
        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.f3a8b2c1d0e5',
            'Enter a {{value0}} title.',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
        })
        return
      }

      if (!base || stripBaseRef(base).toLowerCase() === stripBaseRef(branchName).toLowerCase()) {
        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.ae743199cd',
            'Choose a different base branch before creating a {{value0}}.',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
        })
        return
      }

      createPrInFlightRef.current[activeWorktreeId] = true
      setCreatePrInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: true }))
      setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
      try {
        const createInput = {
          repoId: activeRepo.id,
          provider: hostedReviewCreateProvider,
          base,
          head: normalizeHostedReviewHeadRef(branchName),
          title,
          body: prBody,
          draft: prDraft,
          worktreePath,
          useTemplate: resolvedPrCreationDefaults.useTemplate
        }
        const result = stacked
          ? await createStackedHostedReview(activeRepo.path, createInput)
          : await createHostedReview(activeRepo.path, createInput)

        if (result.ok) {
          setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
          await handlePullRequestCreated({
            provider: hostedReviewCreateProvider,
            number: result.number,
            url: result.url
          })
          if (resolvedPrCreationDefaults.openAfterCreate) {
            window.api.shell.openUrl(result.url)
          }
          return
        }

        if ('existingReview' in result && result.existingReview?.url) {
          const number = result.existingReview.number
          toast.success(
            number
              ? translate(
                  'auto.components.right.sidebar.SourceControl.eef5446523',
                  '{{value0}} #{{value1}} is already open',
                  { value0: hostedReviewCreateCopy.titleLabel, value1: number }
                )
              : translate(
                  'auto.components.right.sidebar.SourceControl.d6fb1df5fe',
                  '{{value0}} is already open',
                  { value0: hostedReviewCreateCopy.titleLabel }
                ),
            {
              action: {
                label: translate(
                  'auto.components.right.sidebar.SourceControl.812cb992ee',
                  'Open on {{value0}}',
                  { value0: hostedReviewCreateCopy.providerName }
                ),
                onClick: () => window.api.shell.openUrl(result.existingReview!.url)
              }
            }
          )
          if (number) {
            setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
            await handlePullRequestCreated({
              provider: hostedReviewCreateProvider,
              number,
              url: result.existingReview.url
            })
            return
          }
        }

        // Why: stacked creation can create the pull request and still fail to register
        // the stack. Link the review that exists before surfacing the stack failure, or
        // the workspace stays unaware of a PR the user can already see on GitHub.
        if ('createdReview' in result && result.createdReview?.url) {
          const { number, url } = result.createdReview
          if (number) {
            await handlePullRequestCreated({
              provider: hostedReviewCreateProvider,
              number,
              url
            })
          }
        }

        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message: result.error
        })
      } catch (error) {
        setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
          tone: 'destructive',
          message:
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.right.sidebar.SourceControl.e2b7a1c0d9f4',
                  'Failed to create {{value0}}',
                  { value0: hostedReviewCreateCopy.reviewLabel }
                )
        })
      } finally {
        createPrInFlightRef.current[activeWorktreeId] = false
        setCreatePrInFlightByWorktree((prev) => ({ ...prev, [activeWorktreeId]: false }))
      }
    },
    [
      activeRepo,
      activeWorktreeId,
      branchName,
      createHostedReview,
      createStackedHostedReview,
      handlePullRequestCreated,
      hostedReviewCreation,
      hostedReviewCreateCopy.providerName,
      hostedReviewCreateCopy.reviewLabel,
      hostedReviewCreateCopy.titleLabel,
      hostedReviewCreateProvider,
      prBase,
      prBody,
      prDraft,
      prGenerating,
      prTitle,
      resolvedPrCreationDefaults.openAfterCreate,
      resolvedPrCreationDefaults.useTemplate,
      setCreatePrIntentNoticeForWorktree,
      worktreePath
    ]
  )

  const createHostedReviewForCreatePrIntent = useCallback(
    async (
      token: CreatePrIntentRunToken,
      eligibility: HostedReviewCreationEligibility
    ): Promise<boolean> => {
      if (!activeRepo || !token.branch || !shouldAttemptCreateHostedReviewForIntent(eligibility)) {
        return false
      }

      const base = resolveCreatePrIntentReviewBase({
        currentBaseRef: token.baseRef,
        eligibilityDefaultBaseRef: eligibility.defaultBaseRef,
        composerBaseRef: prBase
      }).trim()
      if (!base || stripBaseRef(base).toLowerCase() === stripBaseRef(token.branch).toLowerCase()) {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.ae743199cd',
            'Choose a different base branch before creating a {{value0}}.',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
        })
        return false
      }

      let fields = {
        base,
        title: resolveCreateReviewDraftTitle({
          branch: token.branch,
          eligibilityTitle: eligibility.title
        }),
        body: eligibility.body ?? prBody,
        draft: resolvedPrCreationDefaults.draft
      }

      if (
        shouldGenerateHostedReviewDetailsForIntent(eligibility) &&
        hasConfiguredSourceControlTextGenerationDefaults({
          actionId: 'pullRequest',
          settings,
          repo: activeRepo
        })
      ) {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'muted',
          message: translate(
            'auto.components.right.sidebar.SourceControl.createPrIntentGeneratingDetails',
            'Generating review details…'
          )
        })
        const target = getCreatePrIntentOperationTarget(token)
        try {
          const generated = await generateRuntimePullRequestFields(target, {
            ...fields,
            provider: eligibility.provider,
            useTemplate: resolvedPrCreationDefaults.useTemplate
          })
          if (generated.branchChangedByPreparation) {
            setCreatePrIntentNoticeForWorktree(token.worktreeId, {
              tone: 'muted',
              message: translate(
                'auto.components.right.sidebar.SourceControl.createPrIntentBranchChangedDuringDetails',
                'Branch changed while generating review details. Retry Create PR.'
              )
            })
            return false
          }
          const resolved = resolveCreatePrIntentGeneratedReviewFields(fields, generated)
          if (!resolved.ok) {
            setCreatePrIntentNoticeForWorktree(token.worktreeId, {
              tone: 'destructive',
              message:
                resolved.error ??
                translate(
                  'auto.components.right.sidebar.SourceControl.createPrIntentEmptyGeneratedBody',
                  'Generated review details did not include a description. Retry Create PR.'
                )
            })
            return false
          }
          fields = resolved.fields
        } catch (error) {
          console.warn('[SourceControl] Create PR intent detail generation failed', error)
          setCreatePrIntentNoticeForWorktree(token.worktreeId, {
            tone: 'destructive',
            message:
              error instanceof Error
                ? error.message
                : translate(
                    'auto.components.right.sidebar.SourceControl.createPrIntentGenerateDetailsFailed',
                    'Could not generate review details. Retry Create PR.'
                  )
          })
          return false
        }
      }

      if (
        !createPrIntentRunStillOwnsWorktree(token) ||
        createPrIntentActiveTargetConflicts(token)
      ) {
        return false
      }
      const createPrIntentIsForeground = (): boolean =>
        createPrIntentRunTokenMatches(token, createPrIntentCurrentTargetRef.current)

      const title = fields.title.trim()
      if (!title) {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.f3a8b2c1d0e5',
            'Enter a {{value0}} title.',
            { value0: hostedReviewCreateCopy.reviewLabel }
          )
        })
        return false
      }

      setCreatePrIntentNoticeForWorktree(token.worktreeId, {
        tone: 'muted',
        message: translate(
          'auto.components.right.sidebar.SourceControl.createPrIntentCreatingReview',
          'Creating review…'
        )
      })
      createPrInFlightRef.current[token.worktreeId] = true
      setCreatePrInFlightByWorktree((prev) => ({ ...prev, [token.worktreeId]: true }))
      try {
        const result = await createHostedReview(activeRepo.path, {
          repoId: activeRepo.id,
          provider: eligibility.provider,
          base: fields.base,
          head: normalizeHostedReviewHeadRef(token.branch),
          title,
          body: fields.body,
          draft: fields.draft,
          worktreePath: token.worktreePath,
          useTemplate: resolvedPrCreationDefaults.useTemplate
        })

        if (result.ok) {
          const openChecks = createPrIntentIsForeground()
          await handlePullRequestCreated(
            {
              provider: eligibility.provider,
              number: result.number,
              url: result.url
            },
            {
              repoPath: activeRepo.path,
              repoId: activeRepo.id,
              branch: token.branch,
              worktreeId: token.worktreeId,
              openChecks
            }
          )
          if (openChecks && resolvedPrCreationDefaults.openAfterCreate) {
            window.api.shell.openUrl(result.url)
          }
          setCreatePrIntentNoticeForWorktree(token.worktreeId, null)
          return true
        }

        if (result.existingReview?.number && result.existingReview.url) {
          const openChecks = createPrIntentIsForeground()
          await handlePullRequestCreated(
            {
              provider: eligibility.provider,
              number: result.existingReview.number,
              url: result.existingReview.url
            },
            {
              repoPath: activeRepo.path,
              repoId: activeRepo.id,
              branch: token.branch,
              worktreeId: token.worktreeId,
              openChecks
            }
          )
          setCreatePrIntentNoticeForWorktree(token.worktreeId, null)
          return true
        }

        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message: result.error
        })
        return false
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.right.sidebar.SourceControl.e2b7a1c0d9f4',
                'Failed to create {{value0}}',
                { value0: hostedReviewCreateCopy.reviewLabel }
              )
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message
        })
        return false
      } finally {
        createPrInFlightRef.current[token.worktreeId] = false
        setCreatePrInFlightByWorktree((prev) => ({ ...prev, [token.worktreeId]: false }))
      }
    },
    [
      activeRepo,
      createHostedReview,
      createPrIntentActiveTargetConflicts,
      createPrIntentRunStillOwnsWorktree,
      getCreatePrIntentOperationTarget,
      handlePullRequestCreated,
      hostedReviewCreateCopy.reviewLabel,
      prBase,
      prBody,
      resolvedPrCreationDefaults.draft,
      resolvedPrCreationDefaults.openAfterCreate,
      resolvedPrCreationDefaults.useTemplate,
      setCreatePrIntentNoticeForWorktree,
      settings
    ]
  )

  const refreshBranchCompareForCreatePrIntent = useCallback(
    async (token: CreatePrIntentRunToken): Promise<number | undefined> => {
      const baseRef = token.baseRef?.trim()
      if (!baseRef) {
        return undefined
      }
      const requestKey = `${token.worktreeId}:${baseRef}:${Date.now()}:create-pr-intent`
      beginGitBranchCompareRequest(token.worktreeId, requestKey, baseRef)
      const result = await getRuntimeGitBranchCompare(
        {
          // Why: intent may continue after a worktree switch; use the token's original host target, not whatever is focused later.
          settings: activeRepoSettings,
          worktreeId: token.worktreeId,
          worktreePath: token.worktreePath,
          connectionId: getConnectionId(token.worktreeId) ?? undefined
        },
        baseRef
      )
      setGitBranchCompareResult(token.worktreeId, requestKey, result)
      return result.summary.status === 'ready' ? (result.summary.commitsAhead ?? 0) : undefined
    },
    [activeRepoSettings, beginGitBranchCompareRequest, setGitBranchCompareResult]
  )

  const readHostedReviewCreationEligibilityForIntent = useCallback(
    async ({
      token,
      hasUncommittedChanges,
      upstreamStatus
    }: {
      token: CreatePrIntentRunToken
      hasUncommittedChanges: boolean
      upstreamStatus?: NonNullable<typeof remoteStatus>
    }): Promise<HostedReviewCreationEligibility | null> => {
      if (!activeRepo || !token.branch) {
        return null
      }
      let result: HostedReviewCreationEligibility
      try {
        result = await getHostedReviewCreationEligibility({
          repoPath: activeRepo.path,
          repoId: activeRepo.id,
          worktreePath: token.worktreePath,
          branch: token.branch,
          base: token.baseRef ?? null,
          hasUncommittedChanges,
          hasUpstream: upstreamStatus?.hasUpstream,
          ahead: upstreamStatus?.ahead,
          behind: upstreamStatus?.behind,
          linkedGitHubPR,
          fallbackGitHubPR: fallbackGitHubPRNumber,
          linkedGitLabMR,
          linkedBitbucketPR,
          linkedAzureDevOpsPR,
          linkedGiteaPR
        })
      } catch (error) {
        console.warn('[SourceControl] Create PR intent eligibility failed', error)
        // Why: when local status still yields a prep step (dirty/push/sync), keep the intent
        // moving. If nothing actionable can be synthesized, rethrow so the outer intent
        // catch surfaces a retry notice instead of leaving "Preparing…" stuck forever.
        const fallback = buildCreatePrIntentUnavailableEligibility(token.provider, {
          branch: token.branch,
          baseRef: token.baseRef,
          hasUncommittedChanges,
          hasUpstream: upstreamStatus?.hasUpstream,
          ahead: upstreamStatus?.ahead,
          behind: upstreamStatus?.behind
        })
        if (!fallback) {
          throw error
        }
        result = fallback
      }
      setHostedReviewCreationState({
        repoId: activeRepo.id,
        worktreeId: token.worktreeId,
        branch: token.branch,
        data: result
      })
      return result
    },
    [
      activeRepo,
      fallbackGitHubPRNumber,
      getHostedReviewCreationEligibility,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGiteaPR,
      linkedGitHubPR,
      linkedGitLabMR
    ]
  )

  const refreshGitStatusForCreatePrIntent = useCallback(
    async (token: CreatePrIntentRunToken) => {
      if (isFolder) {
        return null
      }
      const target = getCreatePrIntentOperationTarget(token)
      return await refreshGitStatusForWorktreeStrict({
        // Why: intent can finish in the background after navigation; branch-safety checks must inspect the worktree that started it.
        settings: target.settings,
        worktreeId: target.worktreeId,
        worktreePath: target.worktreePath,
        connectionId: target.connectionId,
        pushTarget: target.pushTarget,
        deps: {
          setGitStatus,
          updateWorktreeGitIdentity,
          setUpstreamStatus
        }
      })
    },
    [
      getCreatePrIntentOperationTarget,
      isFolder,
      setGitStatus,
      setUpstreamStatus,
      updateWorktreeGitIdentity
    ]
  )

  const runCreatePrIntent = useCallback(async (): Promise<void> => {
    if (
      !activeRepo ||
      !activeWorktreeId ||
      !worktreePath ||
      !branchName ||
      isExecutingBulk ||
      isCommitting ||
      isGenerating ||
      isRemoteOperationActive ||
      prGenerating ||
      isCreatingPr ||
      createPrIntentInFlightRef.current[activeWorktreeId]
    ) {
      return
    }

    const token = createCreatePrIntentRunToken({
      repoId: activeRepo.id,
      worktreeId: activeWorktreeId,
      worktreePath,
      branch: branchName,
      // Why: token carries the same provisional provider used for UI copy so a failed
      // eligibility IPC can synthesize local prep steps for the correct host.
      provider: provisionalHostedReviewProvider,
      // Why: intent crosses async commit/push steps, so the base stays tied to what was selected when the run started.
      baseRef: effectiveBaseRef ?? null
    })
    const operationTarget = getCreatePrIntentOperationTarget(token)
    const runIsCurrent = (): boolean =>
      createPrIntentRunStillOwnsWorktree(token) && !createPrIntentActiveTargetConflicts(token)
    let abortedByStaleTarget = false
    const abortIfStale = (): boolean => {
      if (runIsCurrent()) {
        return false
      }
      abortedByStaleTarget = true
      return true
    }
    createPrIntentRunTokenRef.current[token.worktreeId] = token
    createPrIntentInFlightRef.current[token.worktreeId] = true
    setCreatePrIntentInFlightByWorktree((prev) => ({ ...prev, [token.worktreeId]: true }))
    setCreatePrIntentNoticeForWorktree(token.worktreeId, {
      tone: 'muted',
      message: translate(
        'auto.components.right.sidebar.SourceControl.d37e68f61d',
        'Preparing branch for review…'
      )
    })

    try {
      let latestStatusEntries = entries
      let latestUpstreamStatus = remoteStatus
      const refreshIntentSnapshot = async (): Promise<boolean> => {
        const refreshed = await refreshGitStatusForCreatePrIntent(token)
        if (!refreshed) {
          return false
        }
        // Why: a terminal checkout may land in this snapshot before React updates the target ref; stop before staging/committing/pushing on a different branch.
        if (!createPrIntentGitStatusMatchesToken(token, refreshed.status)) {
          abortedByStaleTarget = true
          return false
        }
        if (abortIfStale()) {
          return false
        }
        latestStatusEntries = refreshed.status.entries
        latestUpstreamStatus = refreshed.upstreamStatus
        return true
      }
      const stageLatestIntentPaths = async (): Promise<boolean> => {
        const stagePaths = getCreatePrIntentStagePaths({
          unstaged: latestStatusEntries.filter((entry) => entry.area === 'unstaged'),
          untracked: latestStatusEntries.filter((entry) => entry.area === 'untracked')
        })
        if (stagePaths.length === 0) {
          return true
        }
        setIsExecutingBulk(true)
        try {
          await bulkStageRuntimeGitPaths(operationTarget, stagePaths)
        } finally {
          setIsExecutingBulk(false)
        }
        if (abortIfStale()) {
          return false
        }
        return refreshIntentSnapshot()
      }

      if (!(await refreshIntentSnapshot())) {
        return
      }

      // Why: fast-forward behind-only before commit so a dirty worktree can't become ahead+behind and dead-end at the sync-first stop; --ff-only never auto-merges.
      if (isBehindOnlyUpstream(latestUpstreamStatus)) {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'muted',
          message: translate(
            'auto.components.right.sidebar.SourceControl.createPrIntentFastForwarding',
            'Updating branch…'
          )
        })
        const earlyFfResult = await runRemoteAction('fast_forward', {
          target: operationTarget
        })
        if (abortIfStale()) {
          return
        }
        if (earlyFfResult.status === 'superseded') {
          return
        }
        if (earlyFfResult.status !== 'ok') {
          setCreatePrIntentNoticeForWorktree(token.worktreeId, {
            tone: 'destructive',
            message: translate(
              'auto.components.right.sidebar.SourceControl.createPrIntentRemoteFailed',
              'Could not update the remote branch. Retry Create PR.'
            )
          })
          return
        }
        if (!(await refreshIntentSnapshot())) {
          return
        }
      }

      if (!(await stageLatestIntentPaths())) {
        return
      }

      const stagedEntries = latestStatusEntries.filter((entry) => entry.area === 'staged')
      if (stagedEntries.length > 0) {
        let message = readCommitDraftForWorktree(commitDraftsRef.current, token.worktreeId).trim()
        if (!message) {
          setCreatePrIntentNoticeForWorktree(token.worktreeId, {
            tone: 'muted',
            message: translate(
              'auto.components.right.sidebar.SourceControl.8d8f5c6c94',
              'Generating commit message…'
            )
          })
          const generated = await generateCommitMessageForCreatePrIntent(token)
          if (abortIfStale()) {
            return
          }
          if (!generated.ok || !generated.message) {
            setCreatePrIntentNoticeForWorktree(token.worktreeId, {
              tone: generated.reason === 'settings' ? 'muted' : 'destructive',
              message: translate(
                generated.reason === 'settings'
                  ? 'auto.components.right.sidebar.SourceControl.createPrIntentConfigureAi'
                  : 'auto.components.right.sidebar.SourceControl.createPrIntentGenerateFailed',
                generated.reason === 'settings'
                  ? 'Add a commit message or configure Source Control AI settings.'
                  : 'Could not generate a commit message. Add one and retry.'
              ),
              action: generated.reason === 'settings' ? 'settings' : undefined
            })
            return
          }
          const draftAfterGeneration = readCommitDraftForWorktree(
            commitDraftsRef.current,
            token.worktreeId
          ).trim()
          if (draftAfterGeneration) {
            setCreatePrIntentNoticeForWorktree(token.worktreeId, {
              tone: 'muted',
              message: translate(
                'auto.components.right.sidebar.SourceControl.fda060d6ce',
                'Review the commit message, then retry Create PR.'
              )
            })
            return
          }
          message = generated.message
          updateCommitDrafts((prev) => writeCommitDraftForWorktree(prev, token.worktreeId, message))
        }

        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'muted',
          message: translate(
            'auto.components.right.sidebar.SourceControl.b75cb1fd0c',
            'Committing changes…'
          )
        })
        const committed = await handleCommit(message, {
          skipStagedSnapshotCheck: true,
          skipActiveConflictCheck: true,
          target: operationTarget
        })
        if (abortIfStale()) {
          return
        }
        if (!committed) {
          // Why: pre-commit/lint hooks may rewrite tracked files before failing; re-stage those outputs so retrying Create PR doesn't strand changes.
          if (await refreshIntentSnapshot()) {
            await stageLatestIntentPaths()
          }
          if (abortIfStale()) {
            return
          }
          const commitFailure = commitErrorsRef.current[token.worktreeId] ?? null
          setCreatePrIntentNoticeForWorktree(token.worktreeId, {
            tone: 'destructive',
            message: getCreatePrIntentCommitFailureNoticeMessage(commitFailure, {
              fallback: translate(
                'auto.components.right.sidebar.SourceControl.createPrIntentCommitFailed',
                'Could not commit changes. Fix the issue, then retry Create PR.'
              ),
              withSummary: (summary) =>
                translate(
                  'auto.components.right.sidebar.SourceControl.createPrIntentCommitBlockedSummary',
                  'Commit blocked: {{value0}} Fix the issue, then retry Create PR.',
                  { value0: summary }
                )
            })
          })
          return
        }
        if (!(await refreshIntentSnapshot())) {
          return
        }
      }

      let eligibility = await readHostedReviewCreationEligibilityForIntent({
        token,
        hasUncommittedChanges: latestStatusEntries.length > 0,
        upstreamStatus: latestUpstreamStatus
      })
      if (abortIfStale()) {
        return
      }
      if (!eligibility) {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.d7492cafce',
            'Could not refresh Source Control. Retry Create PR.'
          )
        })
        return
      }
      if (shouldAttemptCreateHostedReviewForIntent(eligibility)) {
        await createHostedReviewForCreatePrIntent(token, eligibility)
        if (abortIfStale()) {
          return
        }
        return
      }
      if (eligibility.blockedReason === 'existing_review') {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, null)
        return
      }

      const branchAhead =
        eligibility.blockedReason === 'no_upstream'
          ? await refreshBranchCompareForCreatePrIntent(token)
          : undefined
      if (abortIfStale()) {
        return
      }
      const remoteStep = resolveCreatePrIntentRemoteStep({
        upstreamStatus: latestUpstreamStatus,
        hostedReviewCreation: eligibility,
        branchCommitsAhead: branchAhead,
        hasCurrentBranch: Boolean(token.branch)
      })
      if (remoteStep === 'blocked' || remoteStep === 'none') {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'muted',
          // Why: a diverged branch is deliberately not auto-prepared (would merge without consent), so keep explicit sync-first guidance.
          message:
            eligibility.blockedReason === 'needs_sync'
              ? translate(
                  'auto.components.right.sidebar.SourceControl.createPrIntentNeedsSync',
                  'Sync this branch before creating a review.'
                )
              : translate(
                  'auto.components.right.sidebar.SourceControl.createPrIntentBranchNotReady',
                  'Branch is not ready to create a review yet.'
                )
        })
        return
      }

      setCreatePrIntentNoticeForWorktree(token.worktreeId, {
        tone: 'muted',
        // Why: keep each translate() key a string literal so the localization-catalog verifier can statically detect it.
        message:
          remoteStep === 'publish'
            ? translate(
                'auto.components.right.sidebar.SourceControl.createPrIntentPublishing',
                'Publishing branch…'
              )
            : remoteStep === 'force_push'
              ? translate(
                  'auto.components.right.sidebar.SourceControl.createPrIntentForcePushing',
                  'Force pushing with lease…'
                )
              : remoteStep === 'fast_forward'
                ? translate(
                    'auto.components.right.sidebar.SourceControl.createPrIntentFastForwarding',
                    'Updating branch…'
                  )
                : translate(
                    'auto.components.right.sidebar.SourceControl.createPrIntentPushing',
                    'Pushing commits…'
                  )
      })
      const remoteResult = await runRemoteAction(remoteStep, {
        target: operationTarget,
        baseRef: token.baseRef
      })
      if (abortIfStale()) {
        return
      }
      // Superseded by a newer remote action — drop quietly, same as target drift.
      if (remoteResult.status === 'superseded') {
        return
      }
      if (remoteResult.status !== 'ok') {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.createPrIntentRemoteFailed',
            'Could not update the remote branch. Retry Create PR.'
          )
        })
        return
      }
      if (!(await refreshIntentSnapshot())) {
        return
      }
      await refreshBranchCompareForCreatePrIntent(token)
      if (abortIfStale()) {
        return
      }
      eligibility = await readHostedReviewCreationEligibilityForIntent({
        token,
        hasUncommittedChanges: latestStatusEntries.length > 0,
        upstreamStatus: latestUpstreamStatus
      })
      if (abortIfStale()) {
        return
      }
      if (eligibility && shouldAttemptCreateHostedReviewForIntent(eligibility)) {
        await createHostedReviewForCreatePrIntent(token, eligibility)
        if (abortIfStale()) {
          return
        }
        return
      }
      // Why: prefer the blocked-reason notice (incl. unavailable lookup) over a generic stop.
      const blockedNotice = resolveBlockedCreateReviewNoticeMessage(eligibility)
      setCreatePrIntentNoticeForWorktree(token.worktreeId, {
        tone: blockedNotice ? 'destructive' : 'muted',
        message:
          blockedNotice ??
          translate(
            'auto.components.right.sidebar.SourceControl.995c5e67ec',
            'Review setup needs attention.'
          )
      })
    } catch (error) {
      console.warn('[SourceControl] Create PR intent failed', error)
      if (!abortIfStale()) {
        setCreatePrIntentNoticeForWorktree(token.worktreeId, {
          tone: 'destructive',
          message: translate(
            'auto.components.right.sidebar.SourceControl.d7492cafce',
            'Could not refresh Source Control. Retry Create PR.'
          )
        })
      }
    } finally {
      if (createPrIntentRunTokenRef.current[token.worktreeId] === token) {
        createPrIntentInFlightRef.current[token.worktreeId] = false
        createPrIntentRunTokenRef.current[token.worktreeId] = null
        if (abortedByStaleTarget) {
          setCreatePrIntentNoticeForWorktree(token.worktreeId, null)
        }
        setCreatePrIntentInFlightByWorktree((prev) => ({
          ...prev,
          [token.worktreeId]: false
        }))
      }
    }
  }, [
    activeRepo,
    activeWorktreeId,
    branchName,
    createPrIntentActiveTargetConflicts,
    createPrIntentRunStillOwnsWorktree,
    createHostedReviewForCreatePrIntent,
    effectiveBaseRef,
    entries,
    generateCommitMessageForCreatePrIntent,
    getCreatePrIntentOperationTarget,
    handleCommit,
    isCommitting,
    isCreatingPr,
    isExecutingBulk,
    isGenerating,
    isRemoteOperationActive,
    prGenerating,
    readHostedReviewCreationEligibilityForIntent,
    refreshGitStatusForCreatePrIntent,
    refreshBranchCompareForCreatePrIntent,
    provisionalHostedReviewProvider,
    remoteStatus,
    runRemoteAction,
    setCreatePrIntentNoticeForWorktree,
    setIsExecutingBulk,
    updateCommitDrafts,
    worktreePath
  ])

  const {
    hasPartiallyStagedChanges,
    primaryAction,
    createPrHeaderAction,
    directCreatePrAction,
    visibleCreatePrHeaderAction,
    dropdownItems
  } = useSourceControlActionModel({
    grouped,
    commitMessage,
    unresolvedConflictCount: unresolvedConflicts.length,
    isCommitting,
    isRemoteOperationActive,
    isAbortingOperation,
    remoteStatusForActions,
    hostedReviewStateForActions,
    isHostedReviewStateLoading,
    inFlightRemoteOpKind,
    hostedReviewCreation,
    branchSummary,
    branchName,
    canUseHostedReviewPushTarget,
    isCreatePrIntentInFlight,
    remoteStatus,
    hostedReviewState: hostedReview?.state ?? null,
    hostedReviewCreationForHeader,
    isHostedReviewCreationLoading,
    prGenerating,
    isCreatingPr,
    hostedReviewReviewLabel: hostedReviewCreateCopy.reviewLabel,
    conflictOperation,
    effectiveBaseRef
  })

  // Dispatch primary + dropdown action kinds to their handlers.
  const handleActionInvoke = useCallback(
    (kind: DropdownActionKind): void => {
      if (prGenerating || isCreatingPr || isCreatePrIntentInFlight) {
        return
      }
      switch (kind) {
        case 'commit':
          void handleCommit()
          return
        case 'commit_push':
          void runCompoundCommitAction('push')
          return
        case 'commit_sync':
          void runCompoundCommitAction('sync')
          return
        case 'abort_merge':
          void handleAbortMerge()
          return
        case 'abort_rebase':
          void handleAbortRebase()
          return
        case 'create_pr':
          void handleCreatePullRequest()
          return
        case 'push_create_pr':
          void runCreatePrIntent()
          return
        case 'push':
        case 'force_push':
        case 'pull':
        case 'fast_forward':
        case 'sync':
        case 'fetch':
        case 'publish':
        case 'rebase_base':
          void runRemoteAction(kind === 'rebase_base' ? 'rebase' : kind)
      }
    },
    [
      handleCommit,
      handleCreatePullRequest,
      handleAbortMerge,
      handleAbortRebase,
      isCreatingPr,
      isCreatePrIntentInFlight,
      prGenerating,
      runCreatePrIntent,
      runCompoundCommitAction,
      runRemoteAction
    ]
  )

  // Why: 'stage' routes to a primary-only handler since handleActionInvoke is typed to DropdownActionKind (compound commit_* kinds are dropdown-only).
  const handlePrimaryClick = useCallback((): void => {
    switch (primaryAction.kind) {
      case 'stage':
        void handleStageAllPrimary()
        return
      case 'push':
        // Why: primary labels "Force Push" but keeps kind 'push', so invoke the explicit force path when lease force is required.
        handleActionInvoke(
          shouldForcePushWithLeaseForUpstream(remoteStatusForActions ?? remoteStatus)
            ? 'force_push'
            : 'push'
        )
        return
      case 'commit':
      case 'pull':
      case 'sync':
      case 'publish':
      case 'create_pr':
        handleActionInvoke(primaryAction.kind)
        return
      case 'create_pr_intent':
        void runCreatePrIntent()
    }
  }, [
    handleActionInvoke,
    handleStageAllPrimary,
    primaryAction.kind,
    remoteStatus,
    remoteStatusForActions,
    runCreatePrIntent
  ])

  const handleSourceControlKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      handleSourceControlCommitShortcut(event, primaryAction, handlePrimaryClick)
    },
    [handlePrimaryClick, primaryAction]
  )

  const handleCreatePrHeaderClick = useCallback((): void => {
    if (!createPrHeaderAction || createPrHeaderAction.disabled) {
      return
    }
    if (createPrHeaderAction.kind === 'create_pr') {
      void handleCreatePullRequest()
      return
    }
    if (createPrHeaderAction.kind === 'create_pr_intent') {
      void runCreatePrIntent()
    }
  }, [createPrHeaderAction, handleCreatePullRequest, runCreatePrIntent])

  useEffect(() => {
    // Why: gate on isBranchVisible so we don't spawn git processes while the sidebar is closed.
    if (!activeWorktreeId || !worktreePath || isFolder || !isBranchVisible) {
      return
    }
    const connectionId = getConnectionId(activeWorktreeId) ?? undefined
    void fetchUpstreamStatus(
      activeWorktreeId,
      worktreePath,
      connectionId,
      activeWorktree?.pushTarget,
      { runtimeTargetSettings: activeRepoSettings }
    )
  }, [
    activeRepoSettings,
    activeWorktree?.pushTarget,
    activeWorktreeId,
    fetchUpstreamStatus,
    isBranchVisible,
    isFolder,
    worktreePath
  ])

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }, [])

  const toggleTreeDir = useCallback((key: string) => {
    setCollapsedTreeDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const { loadCommitFiles, openHistoryCommitDiff, openCommitFile, handleCommitAction } =
    useGitHistoryCommitActions({
      activeWorktreeId,
      worktreePath,
      activeRepoSettings,
      resolveSplitTargetGroupId
    })

  // Why: route the note by relative filePath to whichever diff surface owns it — unstaged, then branch compare, else a plain editor tab.
  const { handleOpenComment, setSourceControlRoot } = useSourceControlNoteOpening({
    activeWorktreeId,
    worktreePath,
    entries,
    branchEntries,
    branchSummary,
    handleOpenDiff,
    openCommittedDiff,
    sourceControlRef
  })

  const { handleStage, handleUnstage, discardSingle, discardMany } = useSourceControlEntryMutations(
    {
      activeRepoSettings,
      activeWorktreeId,
      worktreePath,
      refreshActiveGitStatusAfterMutation
    }
  )

  const {
    pendingDiscard,
    requestDiscardAllInArea,
    requestDiscardEntry,
    requestDiscardPaths,
    cancelPendingDiscard,
    confirmPendingDiscard
  } = useSourceControlDiscardConfirmation({
    activeRepoSettings,
    activeWorktreeId,
    worktreePath,
    grouped,
    isExecutingBulk,
    setIsExecutingBulk,
    clearSelection,
    discardMany,
    discardSingle,
    refreshActiveGitStatusAfterMutation
  })

  if (!activeWorktree || !activeRepo || !worktreePath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
        {translate(
          'auto.components.right.sidebar.SourceControl.c07b236287',
          'Select a workspace to view changes'
        )}
      </div>
    )
  }
  if (isFolder) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
        {translate(
          'auto.components.right.sidebar.SourceControl.e131cd7128',
          'Source Control is only available for Git repositories'
        )}
      </div>
    )
  }

  const hasFilteredUncommittedEntries =
    filteredGrouped.staged.length > 0 ||
    filteredGrouped.unstaged.length > 0 ||
    filteredGrouped.untracked.length > 0
  const hasFilteredBranchEntries = filteredBranchEntries.length > 0
  const showGenericEmptyState =
    !hasUncommittedEntries && branchSummary?.status === 'ready' && branchEntries.length === 0
  const currentWorktreeId = activeWorktree.id

  return (
    <>
      <div
        ref={setSourceControlRoot}
        className="relative flex h-full flex-col overflow-hidden"
        onKeyDown={handleSourceControlKeyDown}
      >
        <SourceControlHeaderToolbar
          filterQuery={filterQuery}
          filterExpanded={filterExpanded}
          onFilterQueryChange={setFilterQuery}
          onFilterExpandedChange={setFilterExpanded}
          visibleCreatePrHeaderAction={visibleCreatePrHeaderAction}
          hostedReview={hostedReview}
          isCreatePrIntentInFlight={isCreatePrIntentInFlight}
          isCreatingPr={isCreatingPr || prGenerating}
          onCreatePrHeaderClick={handleCreatePrHeaderClick}
          onOpenHostedReviewInChecks={openHostedReviewInChecks}
          sourceControlViewMode={sourceControlViewMode}
          viewModeToggleDisabled={settings === null}
          onToggleViewMode={handleToggleSourceControlViewMode}
          onChangeBaseRef={() => setBaseRefDialogOpen(true)}
          onRefreshBranchCompare={() => void refreshBranchCompare()}
          branchCompareRefreshDisabled={!branchSummary || branchSummary.status === 'loading'}
          diffCommentCount={diffCommentCount}
          onExpandNotes={() => setDiffCommentsExpanded(true)}
          branchSummary={branchSummary}
          branchLineTotal={branchLineTotal}
          compareBaseRef={compareBaseRef}
          headDisplay={gitIdentityDisplay}
          upstreamStatus={remoteStatus}
          manualReviewUrl={manualReviewUrl}
        />

        {/* Why: hidden when count is 0 — notes are created from the diff view, so an empty Notes shelf here is pure chrome. */}
        {activeWorktreeId && worktreePath && diffCommentCount > 0 && (
          <SourceControlNotesShelf
            activeWorktreeId={activeWorktreeId}
            activeGroupId={activeGroupId}
            diffCommentsForActive={diffCommentsForActive}
            diffCommentCount={diffCommentCount}
            diffCommentsExpanded={diffCommentsExpanded}
            setDiffCommentsExpanded={setDiffCommentsExpanded}
            diffCommentsCopied={diffCommentsCopied}
            handleCopyDiffComments={handleCopyDiffComments}
            setPendingDiffCommentsClear={setPendingDiffCommentsClear}
            deleteDiffComment={deleteDiffComment}
            handleOpenComment={handleOpenComment}
          />
        )}

        <div
          ref={setFileListScrollElement}
          className="relative flex flex-1 flex-col overflow-auto scrollbar-sleek pt-1"
          style={{ paddingBottom: selectedKeys.size > 0 ? 50 : undefined }}
        >
          <SourceControlContentStatus
            unresolvedConflictCount={unresolvedConflictReviewEntries.length}
            conflictOperation={conflictOperation}
            sourceControlAiActionsVisible={sourceControlAiActionsVisible}
            isAbortingOperation={isAbortingOperation}
            onAbortOperation={handleAbortOperationForConflict}
            onResolveWithAi={() => void handleResolveConflictsWithAI()}
            onReviewConflicts={() => {
              openConflictReview(
                currentWorktreeId,
                worktreePath,
                unresolvedConflictReviewEntries,
                'live-summary'
              )
            }}
            repositoryHuge={repositoryHuge}
            worktreeId={currentWorktreeId}
            onRetryStatus={refreshActiveGitStatus}
            showGenericEmptyState={showGenericEmptyState}
            normalizedFilter={normalizedFilter}
            branchBaseRef={branchSummary?.baseRef ?? null}
            filterTooLarge={fileFilterState.tooLarge}
            hasFilteredUncommittedEntries={hasFilteredUncommittedEntries}
            hasFilteredBranchEntries={hasFilteredBranchEntries}
            filterQuery={filterQuery}
          />

          {/* Why: keep CommitArea mounted across normal states — gating on hasUncommittedEntries (#1448) would unmount the action surface on clean worktrees and mid-commit as the staged list clears. Active merge/rebase/cherry-pick is the exception. */}
          <SourceControlForkPushNotice pushTarget={activeWorktree.pushTarget ?? null} />

          {shouldRenderCommitArea(unresolvedConflicts.length, conflictOperation) &&
            (directCreatePrAction ? (
              <CreateHostedReviewComposer
                key={`${activeRepo?.id ?? ''}:${activeWorktreeId ?? worktreePath ?? ''}:${branchName}`}
                provider={hostedReviewCreateProvider}
                branch={branchName}
                base={prBase}
                repoDefaultBase={prRepoDefaultBaseRef}
                setBase={setPrBase}
                title={prTitle}
                setTitle={setPrTitle}
                body={prBody}
                setBody={setPrBody}
                draft={prDraft}
                setDraft={setPrDraft}
                stackedCreationSupported={prStackedCreationSupported}
                stackParentReview={stackParentReview}
                baseQuery={prBaseQuery}
                setBaseQuery={setPrBaseQuery}
                baseResults={prBaseResults}
                setBaseResults={setPrBaseResults}
                baseSearchPending={prBaseSearchPending}
                baseSearchError={prBaseSearchError}
                aiGenerationEnabled={sourceControlAiActionsVisible && prAiGenerationEnabled}
                generating={prGenerating}
                generateDisabled={prGenerateDisabled}
                generateDisabledReason={prGenerateDisabledReason}
                generateError={prGenerateError}
                createError={
                  createPrIntentNotice?.tone === 'destructive' ? createPrIntentNotice.message : null
                }
                isCreating={isCreatingPr}
                primaryAction={directCreatePrAction}
                dropdownItems={dropdownItems}
                onGenerate={handleGeneratePullRequestFieldsClick}
                onCancelGenerate={handleCancelGeneratePullRequestFields}
                onPrimaryAction={(stacked) => {
                  void handleCreatePullRequest(stacked)
                }}
                onDropdownAction={handleActionInvoke}
              />
            ) : (
              <CommitArea
                worktreeId={activeWorktreeId}
                connectionId={activeConnectionId}
                repoId={activeRepo?.id ?? null}
                launchPlatform={activeSourceControlLaunchPlatform}
                commitMessage={commitMessage}
                commitError={commitError}
                commitFailureRecoveryPrompt={commitFailureRecoveryPrompt}
                pushRecovery={pushRecovery}
                remoteActionError={pushRecovery ? null : (remoteActionError?.message ?? null)}
                createPrIntentNotice={createPrIntentNotice}
                isCommitting={isCommitting}
                isFixingCommitFailureWithAI={isLaunchingCommitFailureAgent}
                isFixingPushFailureWithAI={isLaunchingPushFailureAgent}
                isCreatingPr={isCreatingPr || isCreatePrIntentInFlight}
                isCreatePrIntentInFlight={isCreatePrIntentInFlight}
                groupId={activeGroupId ?? activeWorktreeId}
                showComposer={!showGenericEmptyState}
                sourceControlAiActionsVisible={sourceControlAiActionsVisible}
                aiAgentConfigured={resolvedCommitMessageAi?.ok === true}
                isGenerating={isGenerating}
                generateError={generateError}
                stagedCount={grouped.staged.length}
                hasPartiallyStagedChanges={hasPartiallyStagedChanges}
                hasUnresolvedConflicts={unresolvedConflicts.length > 0}
                isRemoteOperationActive={isRemoteOperationActive || isAbortingOperation}
                inFlightRemoteOpKind={inFlightRemoteOpKind}
                primaryAction={primaryAction}
                dropdownItems={dropdownItems}
                fixCommitFailureRecipe={getLaunchActionRecipe('fixCommitFailure')}
                fixPushFailureRecipe={getLaunchActionRecipe('fixPushFailure')}
                onCommitMessageChange={(value) => {
                  if (!activeWorktreeId) {
                    return
                  }
                  updateCommitDrafts((prev) =>
                    writeCommitDraftForWorktree(prev, activeWorktreeId, value)
                  )
                }}
                onGenerate={handleGenerateCommitMessageClick}
                onCancelGenerate={handleCancelGenerate}
                onSaveLaunchActionDefault={saveLaunchActionDefault}
                onOpenSourceControlAiSettings={openSourceControlAiSettings}
                onFixCommitFailureWithAI={handleFixCommitFailureWithAI}
                onFixPushFailureWithAI={handleFixPushFailureWithAI}
                onPrimaryAction={handlePrimaryClick}
                onDropdownAction={handleActionInvoke}
              />
            ))}

          {hasFilteredUncommittedEntries && (
            <SourceControlUncommittedSections
              displaySections={displaySections}
              unfilteredDisplaySectionsById={unfilteredDisplaySectionsById}
              normalizedFilter={normalizedFilter}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
              onViewSection={(sectionViewAction) => {
                if (sectionViewAction.kind === 'conflict-review') {
                  openConflictReview(
                    currentWorktreeId,
                    worktreePath,
                    sectionViewAction.entries,
                    'live-summary'
                  )
                } else {
                  openAllDiffs(
                    currentWorktreeId,
                    worktreePath,
                    undefined,
                    sectionViewAction.area,
                    sectionViewAction.entries
                  )
                }
              }}
              isExecutingBulk={isExecutingBulk}
              requestDiscardAllInArea={requestDiscardAllInArea}
              handleStageAllPaths={handleStageAllPaths}
              handleUnstagePaths={handleUnstagePaths}
              sourceControlViewMode={sourceControlViewMode}
              visibleTreeRowsBySection={visibleTreeRowsBySection}
              visibleListRowsBySection={visibleListRowsBySection}
              fileListScrollElement={fileListScrollElement}
              collapsedTreeDirs={collapsedTreeDirs}
              toggleTreeDir={toggleTreeDir}
              requestDiscardPaths={requestDiscardPaths}
              expandedSubmoduleKeys={expandedSubmoduleKeys}
              toggleSubmodule={toggleSubmodule}
              currentWorktreeId={currentWorktreeId}
              worktreePath={worktreePath}
              selectedKeySet={selectedKeySet}
              activeOpenRowKeys={activeOpenRowKeys}
              handleSelect={handleSelect}
              handleContextMenu={handleContextMenu}
              revealInExplorer={revealInExplorer}
              activeConnectionId={activeConnectionId}
              handleOpenDiff={handleOpenDiff}
              handleStage={handleStage}
              handleUnstage={handleUnstage}
              requestDiscardEntry={requestDiscardEntry}
              diffCommentCountByPath={diffCommentCountByPath}
            />
          )}

          {shouldShowSourceControlCompareUnavailableCard(
            branchSummary,
            hasUncommittedEntries,
            branchEntries.length > 0,
            Boolean(normalizedFilter)
          ) && branchSummary ? (
            <CompareUnavailable
              summary={branchSummary}
              onChangeBaseRef={() => setBaseRefDialogOpen(true)}
              onRetry={() => void refreshBranchCompare()}
            />
          ) : null}

          {branchSummary?.status === 'ready' && hasFilteredBranchEntries && (
            <SourceControlBranchSection
              branchSummary={branchSummary}
              filteredBranchEntries={filteredBranchEntries}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
              sourceControlViewMode={sourceControlViewMode}
              visibleBranchTreeRows={visibleBranchTreeRows}
              fileListScrollElement={fileListScrollElement}
              collapsedTreeDirs={collapsedTreeDirs}
              toggleTreeDir={toggleTreeDir}
              currentWorktreeId={currentWorktreeId}
              worktreePath={worktreePath}
              revealInExplorer={revealInExplorer}
              activeConnectionId={activeConnectionId}
              openCommittedDiff={openCommittedDiff}
              openBranchAllDiffs={openBranchAllDiffs}
              diffCommentCountByPath={diffCommentCountByPath}
            />
          )}

          {isGitHistoryVisible && (
            // Why: the graph is reference context, so keep it docked at the bottom as the pane scrolls.
            <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-border bg-sidebar/95 backdrop-blur-sm">
              <GitHistoryPanel
                state={gitHistoryState}
                collapsed={collapsedSections.has('history')}
                onToggle={() => toggleSection('history')}
                onRefresh={() => void refreshGitHistory()}
                onOpenCommit={(item) => void openHistoryCommitDiff(item)}
                onLoadCommitFiles={loadCommitFiles}
                onOpenCommitFile={openCommitFile}
                onCommitAction={handleCommitAction}
              />
            </div>
          )}
        </div>

        {selectedKeys.size > 0 && (
          <BulkActionBar
            selectedCount={selectedKeys.size}
            stageableCount={bulkStagePaths.length}
            unstageableCount={bulkUnstagePaths.length}
            onStage={handleBulkStage}
            onUnstage={handleBulkUnstage}
            onClear={clearSelection}
            isExecuting={isExecutingBulk}
          />
        )}
      </div>

      <SourceControlDialogLayer
        clearNotesOpen={resolvedPendingDiffCommentsClear !== null}
        clearNotesDescription={pendingDiffCommentsClearDescription}
        clearNotesCount={pendingDiffCommentsClearCount}
        isClearingNotes={isClearingDiffComments}
        onDismissClearNotes={() => setPendingDiffCommentsClear(null)}
        onConfirmClearNotes={() => void handleConfirmDiffCommentsClear()}
        pendingDiscard={pendingDiscard}
        onCancelDiscard={cancelPendingDiscard}
        onConfirmDiscard={confirmPendingDiscard}
        baseRefDialogOpen={baseRefDialogOpen}
        onBaseRefDialogOpenChange={setBaseRefDialogOpen}
        baseRefRepoId={activeRepo.id}
        pickerBaseRef={pickerBaseRef}
        onSelectBaseRef={(ref) => {
          if (baseRefOwnedByWorktree && activeWorktreeId) {
            void updateWorktreeMeta(activeWorktreeId, { baseRef: ref })
          } else {
            void updateRepo(activeRepo.id, { worktreeBaseRef: ref })
          }
          setBaseRefDialogOpen(false)
          window.setTimeout(() => void refreshBranchCompare(), 0)
        }}
        onUsePrimaryBaseRef={() => {
          if (baseRefOwnedByWorktree && activeWorktreeId) {
            void updateWorktreeMeta(activeWorktreeId, { baseRef: undefined })
          } else {
            void updateRepo(activeRepo.id, { worktreeBaseRef: undefined })
          }
          setBaseRefDialogOpen(false)
          window.setTimeout(() => void refreshBranchCompare(), 0)
        }}
        sourceControlAiActionsVisible={sourceControlAiActionsVisible}
        resolveConflictsComposerOpen={resolveConflictsComposerOpen}
        onResolveConflictsComposerOpenChange={setResolveConflictsComposerOpen}
        resolveConflictsPrompt={resolveConflictsPrompt}
        worktreeId={activeWorktreeId}
        groupId={activeGroupId ?? activeWorktreeId}
        connectionId={activeConnectionId}
        repoId={activeRepo?.id ?? null}
        launchPlatform={activeSourceControlLaunchPlatform}
        savedResolveConflictsAgentId={readSourceControlLaunchRecipeAgentId(
          getLaunchActionRecipe('resolveConflicts')
        )}
        savedResolveConflictsCommandInputTemplate={
          getLaunchActionRecipe('resolveConflicts').commandInputTemplate ?? null
        }
        savedResolveConflictsAgentArgs={getLaunchActionRecipe('resolveConflicts').agentArgs ?? null}
        onSaveAgentDefault={saveLaunchActionDefault}
        onOpenSourceControlAiSettings={openSourceControlAiSettings}
        commitGenerationDialogOpen={commitGenerationDialogOpen}
        onCommitGenerationDialogOpenChange={setCommitGenerationDialogOpen}
        pullRequestGenerationDialogOpen={pullRequestGenerationDialogOpen}
        onPullRequestGenerationDialogOpenChange={setPullRequestGenerationDialogOpen}
        settings={settings}
        repo={activeRepo ?? null}
        discoveryHostKey={sourceControlAiDiscoveryHostKey}
        linkedIssue={activeWorktree?.linkedIssue ?? null}
        onGenerateCommitMessage={(params) => {
          void handleGenerate({ sourceControlAiResolvedParams: params })
        }}
        onSaveCommitMessageDefaults={handleSaveCommitMessageGenerationDefaults}
        onGeneratePullRequestFields={(params) => {
          void handleGeneratePullRequestFields({ sourceControlAiResolvedParams: params })
        }}
        onSavePullRequestDefaults={handleSavePullRequestGenerationDefaults}
      />
    </>
  )
}
const SourceControl = React.memo(SourceControlInner)
export default SourceControl
