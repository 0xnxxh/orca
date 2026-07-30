import type { GitStatusEntry } from '../../../../shared/types'
import { fileNameCollator } from '../../../../shared/file-name-sort'

export const sourceControlPathCollator = fileNameCollator

export function compareGitStatusEntries(a: GitStatusEntry, b: GitStatusEntry): number {
  return (
    getConflictSortRank(a) - getConflictSortRank(b) ||
    sourceControlPathCollator.compare(a.path, b.path)
  )
}

function getConflictSortRank(entry: GitStatusEntry): number {
  if (entry.conflictStatus === 'unresolved') {
    return 0
  }
  if (entry.conflictStatus === 'resolved_locally') {
    return 1
  }
  return 2
}
