import type { DiffSection } from './diff-section-types'

// Why: `diffResult === null` subsumes a dirty check — `dirty` is only ever set from a mounted
// editor's content compare, which implies content was already loaded.
export function shouldRequestCombinedDiffSectionLoad(
  section: Pick<DiffSection, 'diffResult' | 'error'> | undefined,
  isLoading: boolean
): boolean {
  return Boolean(section && section.diffResult === null && !section.error && !isLoading)
}

type ReloadedDiffSectionContent = Pick<
  DiffSection,
  'diffResult' | 'error' | 'largeDiffRenderLimit' | 'originalContent' | 'modifiedContent'
>

/**
 * True when a revalidation refetched exactly what the section already displays, so committing it
 * would swap Monaco models and re-measure the row for no visible change.
 *
 * Why: a rebase fires one watcher event per touched path, and most of those refetch identical diffs.
 */
export function isUnchangedDiffSectionReload(
  current: ReloadedDiffSectionContent,
  next: ReloadedDiffSectionContent
): boolean {
  if (current.error !== next.error) {
    return false
  }
  // Only text diffs compare by content; binary/image results carry data this can't see.
  if (current.diffResult?.kind !== 'text' || next.diffResult?.kind !== 'text') {
    return false
  }
  if (
    (current.largeDiffRenderLimit?.limited ?? false) !==
    (next.largeDiffRenderLimit?.limited ?? false)
  ) {
    return false
  }
  return (
    current.originalContent === next.originalContent &&
    current.modifiedContent === next.modifiedContent
  )
}
