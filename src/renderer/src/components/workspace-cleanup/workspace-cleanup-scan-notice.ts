import { translate } from '@/i18n/i18n'
import type {
  WorkspaceCleanupScanError,
  WorkspaceCleanupScanProgress
} from '../../../../shared/workspace-cleanup'

function isDisconnectedRemoteScanError(message: string): boolean {
  return (
    message === 'SSH provider is unavailable.' ||
    message === 'Remote workspaces are not connected. Reconnect and refresh to check them.'
  )
}

export function formatWorkspaceCleanupScanNotice(
  errors: readonly WorkspaceCleanupScanError[],
  repoNameById: ReadonlyMap<string, string>
): string | null {
  const visibleErrors = errors.filter(
    (error) => !isDisconnectedRemoteScanError(error.message ?? '')
  )
  if (visibleErrors.length === 0) {
    return null
  }
  if (visibleErrors.length === 1) {
    const error = visibleErrors[0]
    const repoName = formatScanErrorRepoName(error, repoNameById)
    return `Could not check ${repoName}: ${formatScanErrorReason(error.message)}. Some workspaces may be missing. Refresh to try again.`
  }
  const repoNames = visibleErrors
    .slice(0, 3)
    .map((error) => formatScanErrorRepoName(error, repoNameById))
    .join(', ')
  const moreCount = visibleErrors.length - 3
  const suffix = moreCount > 0 ? `, +${moreCount} more` : ''
  return `Could not check ${visibleErrors.length} repositories (${repoNames}${suffix}). Some workspaces may be missing. Refresh to try again.`
}

export function formatWorkspaceCleanupScanProgress(
  progress: WorkspaceCleanupScanProgress | null
): string {
  if (!progress || progress.scannedWorktreeCount === 0) {
    return translate(
      'auto.components.workspace.cleanup.WorkspaceCleanupDialog.4cc5b73efe',
      'Finding workspaces...'
    )
  }
  return translate(
    'auto.components.workspace.cleanup.WorkspaceCleanupDialog.7b7bde5181',
    'Checked workspaces so far: {{value0}}',
    { value0: progress.scannedWorktreeCount }
  )
}

export function formatWorkspaceCleanupReadyToast(
  workspaceCount: number,
  suggestedCount: number
): string {
  if (workspaceCount === 0) {
    return 'No workspaces found.'
  }
  const workspaceNoun = workspaceCount === 1 ? 'workspace' : 'workspaces'
  const suggestedNoun = suggestedCount === 1 ? 'suggestion' : 'suggestions'
  return `${workspaceCount} ${workspaceNoun} found, with ${suggestedCount} cleanup ${suggestedNoun}.`
}

function formatScanErrorRepoName(
  error: Partial<WorkspaceCleanupScanError>,
  repoNameById: ReadonlyMap<string, string>
): string {
  const repoName = error.repoName?.trim()
  if (repoName) {
    return repoName
  }
  const fallback = error.repoId ? repoNameById.get(error.repoId)?.trim() : ''
  return fallback || 'a repository'
}

function formatScanErrorReason(message: string | undefined): string {
  if (!message || message === 'Could not scan workspace cleanup for this repository.') {
    return 'Git could not list worktrees'
  }
  return message.replace(/\.$/, '')
}
