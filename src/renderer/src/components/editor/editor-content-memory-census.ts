/**
 * Sizes of the file bodies each mounted editor panel holds in React state.
 *
 * Why this is separate from the store profile: renderer-memory-profile only walks
 * zustand collections, so the largest strings in the renderer — loaded file
 * contents — are structurally invisible when an OOM highwater breadcrumb fires.
 */
import { registerRendererMemoryProfileContributor } from '../../lib/renderer-memory-profile'
import type { DiffContent, FileContent } from './editor-panel-content-types'

export type EditorFileContentCensus = { files: number; chars: number }
/** Separate from file bodies: a diff tab holds two of them, so folding the sums
 *  together hides which of the two shapes filled the heap. */
export type EditorDiffContentCensus = { diffTabs: number; diffChars: number }
export type EditorContentCensus = EditorFileContentCensus & EditorDiffContentCensus

const readers = new Set<() => EditorContentCensus>()

// Why bounded: each reader closes over a panel's fileContents, so a panel that ever
// leaked its unmount would make this diagnostic a retainer of what it measures.
const MAX_CENSUS_READERS = 64

// Why counted: hitting the cap makes the census undercount, and an undercount with
// no signal is worse than no number at all in the one artifact meant to settle
// where the heap went. Cumulative, never decremented — it reports "we dropped at
// least N panels", not a live size.
let droppedReaders = 0

/** Registers one live panel's contents; call the returned function on unmount. */
export function registerEditorContentCensusReader(read: () => EditorContentCensus): () => void {
  if (readers.size >= MAX_CENSUS_READERS) {
    droppedReaders += 1
    return () => {}
  }
  readers.add(read)
  return () => {
    readers.delete(read)
  }
}

export function measureEditorFileContents(
  fileContents: Record<string, FileContent>
): EditorFileContentCensus {
  let files = 0
  let chars = 0
  for (const key in fileContents) {
    if (!Object.hasOwn(fileContents, key)) {
      continue
    }
    files += 1
    chars += fileContents[key]?.content?.length ?? 0
  }
  return { files, chars }
}

/**
 * Why measured at all: a diff tab retains `originalContent` *and* `modifiedContent`,
 * so a review session with many diff tabs holds two full file bodies per tab and
 * shows up nowhere in the file-contents census — the most plausible heap shape for
 * a reviewer's OOM, and previously invisible.
 */
export function measureEditorDiffContents(
  diffContents: Record<string, DiffContent>
): EditorDiffContentCensus {
  let diffTabs = 0
  let diffChars = 0
  for (const key in diffContents) {
    if (!Object.hasOwn(diffContents, key)) {
      continue
    }
    const diff = diffContents[key]
    diffTabs += 1
    diffChars += (diff?.originalContent?.length ?? 0) + (diff?.modifiedContent?.length ?? 0)
  }
  return { diffTabs, diffChars }
}

registerRendererMemoryProfileContributor('editorContent', () => {
  let panels = 0
  let files = 0
  let chars = 0
  let diffTabs = 0
  let diffChars = 0
  for (const read of readers) {
    const census = read()
    panels += 1
    files += census.files
    chars += census.chars
    diffTabs += census.diffTabs
    diffChars += census.diffChars
  }
  // `chars`/`diffChars` are UTF-16 code units, not bytes: CJK and emoji bodies
  // under-report against a byte budget by up to 3x.
  return { panels, files, chars, diffTabs, diffChars, droppedPanels: droppedReaders }
})

/** Test-only: the cap is process-wide, so suites must be able to clear it. */
export function resetEditorContentCensusForTesting(): void {
  readers.clear()
  droppedReaders = 0
}
