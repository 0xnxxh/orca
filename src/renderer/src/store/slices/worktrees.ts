import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { WorktreeSlice } from './worktree-helpers'
import { worktreeSliceInitialState } from './worktrees/worktree-slice-initial-state'
import { createFetchDetectedWorktrees } from './worktrees/fetch-detected-worktrees'
import { createFetchWorktrees } from './worktrees/fetch-worktrees'
import { createFetchAllWorktrees } from './worktrees/fetch-all-worktrees'
import {
  createAssignWorktreeParent,
  createFetchWorktreeLineage,
  createUpdateWorktreeLineage
} from './worktrees/worktree-lineage-actions'
import { createUpdateWorktreeGitIdentity } from './worktrees/worktree-git-identity-update'
import {
  createUpdateWorktreeBaseStatus,
  createUpdateWorktreeRemoteBranchConflict
} from './worktrees/worktree-base-status'
import { createPrefetchWorktreeCreateBase } from './worktrees/prefetch-worktree-create-base'
import { createCreateWorktree } from './worktrees/create-worktree'
import {
  createBeginPendingWorktreeCreation,
  createRemovePendingWorktreeCreation,
  createSetActivePendingWorktreeCreation,
  createUpdatePendingWorktreeCreation
} from './worktrees/pending-worktree-creation'
import { createRemoveWorktree } from './worktrees/remove-worktree'
import {
  createClearWorktreeDeleteState,
  createMarkWorktreesDeleting,
  createMarkWorktreesQueuedForDeletion
} from './worktrees/worktree-delete-state'
import { createForceDeletePreservedBranch } from './worktrees/force-delete-preserved-branch'
import { createUpdateWorktreeMeta } from './worktrees/update-worktree-meta'
import { createEnsureHostedReviewPushTarget } from './worktrees/hosted-review-push-target-ensure'
import { createUpdateWorktreesMeta } from './worktrees/update-worktrees-meta'
import { createSetWorktreesPinnedAndReveal } from './worktrees/worktree-pin-reveal'
import {
  createBumpWorktreeActivity,
  createClearWorktreeUnread,
  createMarkWorktreeUnread,
  createObserveTerminalGitHubPullRequestLink
} from './worktrees/worktree-unread-activity'
import {
  createMarkWorktreeVisited,
  createPruneLastVisitedTimestamps,
  createSeedActiveWorktreeLastVisitedIfMissing
} from './worktrees/worktree-visit-recency'
import { createSetActiveWorktree } from './worktrees/set-active-worktree'
import { createSetActiveFolderWorkspace } from './worktrees/set-active-folder-workspace'
import {
  createAllWorktrees,
  createGetKnownWorktreeById,
  createPurgeWorktreeTerminalState,
  createRemountTerminalTabForRecovery,
  createSetRenamingWorktreeId
} from './worktrees/worktree-slice-lookups'
import { createPurgeStaleRuntimeHostState } from './worktrees/purge-stale-runtime-host-state'
import { createMigrateWorktreeIdentity } from './worktrees/migrate-worktree-identity'

export type { WorktreeSlice, WorktreeDeleteState } from './worktree-helpers'
export { WORKTREE_REFRESH_CONCURRENCY } from './worktrees/worktree-slice-constants'
export { acquireDetectedWorktreeRefreshLeaseForRepo } from './worktrees/detected-worktree-refresh'
export {
  getHostedReviewLinkMutationGenerationForTests,
  getHostedReviewLinkWorktreeAliasCountForTests,
  resetHostedReviewLinkMutationGenerationForTests
} from './worktrees/hosted-review-link-mutation'
export {
  getDetachedHeadAutoDerivedDisplayNameForTests,
  setDetachedHeadAutoDerivedDisplayNameForTests
} from './worktrees/detached-head-display-name'
export { resetAuthoritativelyRemovedWorktreeMemoryForTests } from './worktrees/authoritative-worktree-removal-memory'
export type { DirectSshDetectedWorktreeRefresh } from './worktrees/known-ssh-worktree-fetch'
export { acquireDirectSshDetectedWorktreeRefresh } from './worktrees/known-ssh-worktree-fetch'

export const createWorktreeSlice: StateCreator<AppState, [], [], WorktreeSlice> = (set, get) => ({
  ...worktreeSliceInitialState,
  fetchDetectedWorktrees: createFetchDetectedWorktrees(set, get),
  fetchWorktrees: createFetchWorktrees(set, get),
  fetchAllWorktrees: createFetchAllWorktrees(set, get),
  fetchWorktreeLineage: createFetchWorktreeLineage(set, get),
  updateWorktreeLineage: createUpdateWorktreeLineage(set, get),
  assignWorktreeParent: createAssignWorktreeParent(set, get),
  updateWorktreeGitIdentity: createUpdateWorktreeGitIdentity(set, get),
  updateWorktreeBaseStatus: createUpdateWorktreeBaseStatus(set, get),
  updateWorktreeRemoteBranchConflict: createUpdateWorktreeRemoteBranchConflict(set, get),
  prefetchWorktreeCreateBase: createPrefetchWorktreeCreateBase(set, get),
  createWorktree: createCreateWorktree(set, get),
  beginPendingWorktreeCreation: createBeginPendingWorktreeCreation(set, get),
  updatePendingWorktreeCreation: createUpdatePendingWorktreeCreation(set, get),
  removePendingWorktreeCreation: createRemovePendingWorktreeCreation(set, get),
  setActivePendingWorktreeCreation: createSetActivePendingWorktreeCreation(set, get),
  removeWorktree: createRemoveWorktree(set, get),
  markWorktreesDeleting: createMarkWorktreesDeleting(set, get),
  markWorktreesQueuedForDeletion: createMarkWorktreesQueuedForDeletion(set, get),
  forceDeletePreservedBranch: createForceDeletePreservedBranch(set, get),
  clearWorktreeDeleteState: createClearWorktreeDeleteState(set, get),
  updateWorktreeMeta: createUpdateWorktreeMeta(set, get),
  ensureHostedReviewPushTarget: createEnsureHostedReviewPushTarget(set, get),
  updateWorktreesMeta: createUpdateWorktreesMeta(set, get),
  setWorktreesPinnedAndReveal: createSetWorktreesPinnedAndReveal(set, get),
  markWorktreeUnread: createMarkWorktreeUnread(set, get),
  observeTerminalGitHubPullRequestLink: createObserveTerminalGitHubPullRequestLink(set, get),
  clearWorktreeUnread: createClearWorktreeUnread(set, get),
  bumpWorktreeActivity: createBumpWorktreeActivity(set, get),
  markWorktreeVisited: createMarkWorktreeVisited(set, get),
  pruneLastVisitedTimestamps: createPruneLastVisitedTimestamps(set, get),
  seedActiveWorktreeLastVisitedIfMissing: createSeedActiveWorktreeLastVisitedIfMissing(set, get),
  setRenamingWorktreeId: createSetRenamingWorktreeId(set, get),
  remountTerminalTabForRecovery: createRemountTerminalTabForRecovery(set, get),
  setActiveWorktree: createSetActiveWorktree(set, get),
  setActiveFolderWorkspace: createSetActiveFolderWorkspace(set, get),
  allWorktrees: createAllWorktrees(set, get),
  getKnownWorktreeById: createGetKnownWorktreeById(set, get),
  purgeWorktreeTerminalState: createPurgeWorktreeTerminalState(set, get),
  purgeStaleRuntimeHostState: createPurgeStaleRuntimeHostState(set, get),
  migrateWorktreeIdentity: createMigrateWorktreeIdentity(set, get)
})
