import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { WorktreeSlice } from './worktree-helpers'
import { worktreeSliceInitialState } from './worktrees/slice/worktree-slice-initial-state'
import { createFetchDetectedWorktrees } from './worktrees/refresh/fetch-detected-worktrees'
import { createFetchWorktrees } from './worktrees/refresh/fetch-worktrees'
import { createFetchAllWorktrees } from './worktrees/refresh/fetch-all-worktrees'
import {
  createAssignWorktreeParent,
  createFetchWorktreeLineage,
  createUpdateWorktreeLineage
} from './worktrees/lineage/worktree-lineage-actions'
import { createUpdateWorktreeGitIdentity } from './worktrees/meta/worktree-git-identity-update'
import {
  createUpdateWorktreeBaseStatus,
  createUpdateWorktreeRemoteBranchConflict
} from './worktrees/meta/worktree-base-status'
import { createPrefetchWorktreeCreateBase } from './worktrees/create/prefetch-worktree-create-base'
import { createCreateWorktree } from './worktrees/create/create-worktree'
import {
  createBeginPendingWorktreeCreation,
  createRemovePendingWorktreeCreation,
  createSetActivePendingWorktreeCreation,
  createUpdatePendingWorktreeCreation
} from './worktrees/create/pending-worktree-creation'
import { createRemoveWorktree } from './worktrees/remove/remove-worktree'
import {
  createClearWorktreeDeleteState,
  createMarkWorktreesDeleting,
  createMarkWorktreesQueuedForDeletion
} from './worktrees/remove/worktree-delete-state'
import { createForceDeletePreservedBranch } from './worktrees/remove/force-delete-preserved-branch'
import { createUpdateWorktreeMeta } from './worktrees/meta/update-worktree-meta'
import { createEnsureHostedReviewPushTarget } from './worktrees/hosted-review/hosted-review-push-target-ensure'
import { createUpdateWorktreesMeta } from './worktrees/meta/update-worktrees-meta'
import { createSetWorktreesPinnedAndReveal } from './worktrees/activation/worktree-pin-reveal'
import {
  createBumpWorktreeActivity,
  createClearWorktreeUnread,
  createMarkWorktreeUnread,
  createObserveTerminalGitHubPullRequestLink
} from './worktrees/activation/worktree-unread-activity'
import {
  createMarkWorktreeVisited,
  createPruneLastVisitedTimestamps,
  createSeedActiveWorktreeLastVisitedIfMissing
} from './worktrees/activation/worktree-visit-recency'
import { createSetActiveWorktree } from './worktrees/activation/set-active-worktree'
import { createSetActiveFolderWorkspace } from './worktrees/activation/set-active-folder-workspace'
import {
  createAllWorktrees,
  createGetKnownWorktreeById,
  createPurgeWorktreeTerminalState,
  createRemountTerminalTabForRecovery,
  createSetRenamingWorktreeId
} from './worktrees/slice/worktree-slice-lookups'
import { createPurgeStaleRuntimeHostState } from './worktrees/remove/purge-stale-runtime-host-state'
import { createMigrateWorktreeIdentity } from './worktrees/identity/migrate-worktree-identity'

export type { WorktreeSlice, WorktreeDeleteState } from './worktree-helpers'
export { WORKTREE_REFRESH_CONCURRENCY } from './worktrees/slice/worktree-slice-constants'
export { acquireDetectedWorktreeRefreshLeaseForRepo } from './worktrees/refresh/detected-worktree-refresh'
export {
  getHostedReviewLinkMutationGenerationForTests,
  getHostedReviewLinkWorktreeAliasCountForTests,
  resetHostedReviewLinkMutationGenerationForTests
} from './worktrees/hosted-review/hosted-review-link-mutation'
export {
  getDetachedHeadAutoDerivedDisplayNameForTests,
  setDetachedHeadAutoDerivedDisplayNameForTests
} from './worktrees/meta/detached-head-display-name'
export { resetAuthoritativelyRemovedWorktreeMemoryForTests } from './worktrees/ssh/authoritative-worktree-removal-memory'
export type { DirectSshDetectedWorktreeRefresh } from './worktrees/ssh/known-ssh-worktree-fetch'
export { acquireDirectSshDetectedWorktreeRefresh } from './worktrees/ssh/known-ssh-worktree-fetch'

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
