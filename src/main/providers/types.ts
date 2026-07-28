import type {
  DirEntry,
  FsChangeEvent,
  GitStatusResult,
  GitDiffResult,
  GitBranchCompareResult,
  GitCommitCompareResult,
  GitConflictOperation,
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GitPushTarget,
  GitStagingArea,
  GitUpstreamStatus,
  GitWorktreeInfo,
  TuiAgent,
  RemoveWorktreeResult,
  SearchOptions,
  SearchResult
} from '../../shared/types'
import type { GitHistoryOptions, GitHistoryResult } from '../../shared/git-history'
import type { PtyStartupIngressIntent } from '../../shared/pty-startup-ingress'
import type { CommitMessageDraftContext } from '../../shared/commit-message-generation'
import type { WorkspaceSpaceDirectoryScanResult } from '../../shared/workspace-space-types'
import type { FilesystemPathListingProvider } from './filesystem-path-listing-provider'
import type { StartupCommandDelivery } from '../../shared/codex-startup-delivery'
import type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
import type { GitProviderStatusOptions } from './git-provider-status-options'
import type { PtyBackgroundStreamEvent, PtyDataEvent } from './pty-provider-events'
import type { PtySpawnResult } from './pty-spawn-result'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import type {
  AgentSessionExecutionClaim,
  AgentSessionSurfaceBinding
} from '../../shared/agent-session-host-authority'
import type { PtyProcessInfo } from './pty-process-info'

export type {
  PtyBackgroundStreamEvent,
  PtyDataEvent,
  PtyTransientFact
} from './pty-provider-events'
export type { IProviderRegistry } from './provider-registry-types'

// ─── PTY Provider ───────────────────────────────────────────────────

export type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyDataEvent,
  PtyProcessInfo,
  PtyProviderBufferSnapshot,
  PtySpawnOptions,
  PtySpawnResult,
  PtyTransientFact
} from './pty-provider-contract'

// ─── Filesystem Provider ────────────────────────────────────────────

export type FileStat = {
  size: number
  type: 'file' | 'directory' | 'symlink'
  mtime: number
  mtimeMs?: number
  dev?: number
  ino?: number
  nlink?: number
}

export type FileReadResult = {
  content: string
  isBinary: boolean
  isImage?: boolean
  mimeType?: string
}

export type FileChunkReadResult = { contentBase64: string; bytesRead: number; eof: boolean }

type FilesystemDirectoryReadOptions = { maxEntries?: number; maxRetainedBytes?: number }

export type IFilesystemProvider = FilesystemPathListingProvider & {
  readDir(dirPath: string, options?: FilesystemDirectoryReadOptions): Promise<DirEntry[]>
  readFile(filePath: string): Promise<FileReadResult>
  readFileChunk?(filePath: string, offset: number, length: number): Promise<FileChunkReadResult>
  readTerminalArtifact?(
    filePath: string,
    options: TerminalArtifactAccessOptions
  ): Promise<FileReadResult>
  readTerminalArtifactChunk?(
    filePath: string,
    offset: number,
    length: number,
    options: TerminalArtifactAccessOptions
  ): Promise<FileChunkReadResult>
  downloadFile?(sourcePath: string, destinationPath: string): Promise<void>
  downloadFolder?: (src: string, dest: string, options?: { signal?: AbortSignal }) => Promise<void>
  openFileUploadSession?(): Promise<FileUploadSession>
  getTempDir?(): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  writeTerminalArtifact?(
    filePath: string,
    content: string,
    options: TerminalArtifactAccessOptions
  ): Promise<FileStat>
  writeFileBase64(filePath: string, contentBase64: string): Promise<void>
  writeFileBase64Chunk(filePath: string, contentBase64: string, append: boolean): Promise<void>
  stat(filePath: string): Promise<FileStat>
  lstat?(filePath: string): Promise<FileStat>
  deletePath(targetPath: string, recursive?: boolean): Promise<void>
  createFile(filePath: string): Promise<void>
  createDir(dirPath: string): Promise<void>
  createDirNoClobber(dirPath: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  renameNoClobber(oldPath: string, newPath: string): Promise<void>
  copy(source: string, destination: string): Promise<void>
  realpath(filePath: string): Promise<string>
  search(opts: SearchOptions): Promise<SearchResult>
  listFiles(
    rootPath: string,
    options?: { excludePaths?: string[]; signal?: AbortSignal; maxResults?: number }
  ): Promise<string[]>
  scanWorkspaceSpace?(
    rootPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<WorkspaceSpaceDirectoryScanResult>
  watch(
    rootPath: string,
    callback: (events: FsChangeEvent[]) => void,
    options?: { signal?: AbortSignal; onTerminalError?: (error: Error) => void }
  ): Promise<() => void>
  closeWatch?(rootPath: string): Promise<void>
}

export type FileUploadSession = {
  uploadFile(
    sourcePath: string,
    destinationPath: string,
    options?: { exclusive?: boolean }
  ): Promise<void>
  close(): void
}

export type TerminalArtifactAccessOptions = {
  expectedRealPath: string
  expectedStatIdentity: string | null
  maxBytes: number
}

// ─── Git Provider ───────────────────────────────────────────────────

export type { GitProviderStatusOptions } from './git-provider-status-options'

export type IGitProvider = {
  getStatus(worktreePath: string, options?: GitProviderStatusOptions): Promise<GitStatusResult>
  getSubmoduleStatus(
    worktreePath: string,
    submodulePath: string,
    area?: GitStagingArea
  ): Promise<GitStatusResult>
  checkIgnoredPaths(worktreePath: string, relativePaths: string[]): Promise<string[]>
  getHistory(worktreePath: string, options?: GitHistoryOptions): Promise<GitHistoryResult>
  commit(worktreePath: string, message: string): Promise<{ success: boolean; error?: string }>
  getStagedCommitContext(worktreePath: string): Promise<CommitMessageDraftContext | null>
  getDiff(
    worktreePath: string,
    filePath: string,
    staged: boolean,
    compareAgainstHead?: boolean
  ): Promise<GitDiffResult>
  stageFile(worktreePath: string, filePath: string): Promise<void>
  unstageFile(worktreePath: string, filePath: string): Promise<void>
  bulkStageFiles(worktreePath: string, filePaths: string[]): Promise<void>
  bulkUnstageFiles(worktreePath: string, filePaths: string[]): Promise<void>
  discardChanges(worktreePath: string, filePath: string): Promise<void>
  bulkDiscardChanges(worktreePath: string, filePaths: string[]): Promise<void>
  detectConflictOperation(worktreePath: string): Promise<GitConflictOperation>
  abortMerge(worktreePath: string): Promise<void>
  abortRebase(worktreePath: string): Promise<void>
  checkoutBranch(worktreePath: string, branch: string): Promise<void>
  listLocalBranches(worktreePath: string): Promise<{ current: string | null; branches: string[] }>
  getBranchCompare(worktreePath: string, baseRef: string): Promise<GitBranchCompareResult>
  getCommitCompare(worktreePath: string, commitId: string): Promise<GitCommitCompareResult>
  getUpstreamStatus(worktreePath: string, pushTarget?: GitPushTarget): Promise<GitUpstreamStatus>
  pushBranch(
    worktreePath: string,
    publish?: boolean,
    pushTarget?: GitPushTarget,
    options?: { forceWithLease?: boolean }
  ): Promise<void>
  pullBranch(worktreePath: string, pushTarget?: GitPushTarget): Promise<void>
  fastForwardBranch(worktreePath: string, pushTarget?: GitPushTarget): Promise<void>
  rebaseFromBase(worktreePath: string, baseRef: string): Promise<void>
  fetchRemote(worktreePath: string, pushTarget?: GitPushTarget): Promise<void>
  syncForkDefaultBranch(
    worktreePath: string,
    expectedUpstream: GitForkSyncExpectedUpstream
  ): Promise<GitForkSyncResult>
  getBranchDiff(
    worktreePath: string,
    baseRef: string,
    options?: { includePatch?: boolean; filePath?: string; oldPath?: string }
  ): Promise<GitDiffResult[]>
  getCommitDiff(
    worktreePath: string,
    args: { commitOid: string; parentOid?: string | null; filePath: string; oldPath?: string }
  ): Promise<GitDiffResult>
  listWorktrees(repoPath: string, options?: { signal?: AbortSignal }): Promise<GitWorktreeInfo[]>
  addWorktree(
    repoPath: string,
    branchName: string,
    targetDir: string,
    options?: { base?: string; checkoutExistingBranch?: boolean; noCheckout?: boolean }
  ): Promise<void>
  removeWorktree(
    worktreePath: string,
    force?: boolean,
    options?: { deleteBranch?: boolean; forceBranchDelete?: boolean }
  ): Promise<RemoveWorktreeResult>
  renameCurrentBranch?(worktreePath: string, newBranch: string): Promise<void>
  forceDeletePreservedBranch?(
    repoPath: string,
    branchName: string,
    expectedHead: string
  ): Promise<void>
  isGitRepo(path: string): boolean
  isGitRepoAsync(dirPath: string): Promise<{ isRepo: boolean; rootPath: string | null }>
  exec(
    args: string[],
    cwd: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<{ stdout: string; stderr: string }>
  getRemoteFileUrl(worktreePath: string, relativePath: string, line: number): Promise<string | null>
  getRemoteCommitUrl(worktreePath: string, sha: string): Promise<string | null>
  worktreeIsClean(
    worktreePath: string,
    options?: { includeUntracked?: boolean }
  ): Promise<{ clean: boolean; stdout?: string }>
}
