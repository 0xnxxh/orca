/**
 * Sizes of the file bodies each mounted editor panel holds in React state.
 *
 * Why this is separate from the store profile: renderer-memory-profile only walks
 * zustand collections, so the largest strings in the renderer — loaded file
 * contents — are structurally invisible when an OOM highwater breadcrumb fires.
 */
import { registerRendererMemoryProfileContributor } from '../../lib/renderer-memory-profile'
import type { FileContent } from './editor-panel-content-types'

export type EditorContentCensus = { files: number; chars: number }

const readers = new Set<() => EditorContentCensus>()

// Why bounded: each reader closes over a panel's fileContents, so a panel that ever
// leaked its unmount would make this diagnostic a retainer of what it measures.
const MAX_CENSUS_READERS = 64

/** Registers one live panel's contents; call the returned function on unmount. */
export function registerEditorContentCensusReader(read: () => EditorContentCensus): () => void {
  if (readers.size >= MAX_CENSUS_READERS) {
    return () => {}
  }
  readers.add(read)
  return () => {
    readers.delete(read)
  }
}

export function measureEditorFileContents(
  fileContents: Record<string, FileContent>
): EditorContentCensus {
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

registerRendererMemoryProfileContributor('editorContent', () => {
  let panels = 0
  let files = 0
  let chars = 0
  for (const read of readers) {
    const census = read()
    panels += 1
    files += census.files
    chars += census.chars
  }
  return { panels, files, chars }
})
