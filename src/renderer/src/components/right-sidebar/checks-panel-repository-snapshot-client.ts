import {
  getRuntimeGitRepositorySnapshot,
  type RuntimeGitRepositorySnapshotOptions
} from '@/runtime/runtime-git-repository-snapshot-client'

export type ChecksPanelRepositorySnapshotOptions = RuntimeGitRepositorySnapshotOptions
export const getChecksPanelRepositorySnapshot = getRuntimeGitRepositorySnapshot
