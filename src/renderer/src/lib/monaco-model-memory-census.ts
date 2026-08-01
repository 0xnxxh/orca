/**
 * Size of the Monaco text models the renderer keeps alive, in models and characters.
 *
 * Why this is separate from the editor-content census: that one measures the raw
 * strings a *mounted* React panel holds, while Monaco keeps its own global model
 * registry. A model outlives the panel that opened it (only useClosedEditorTabCleanup
 * disposes one, on tab close) and stores a piece tree plus per-line tokenization and
 * decoration state, so it retains several times its text length. Without this,
 * `editorContent.chars` reads ~0 for exactly the case that matters — panels
 * unmounted, models retained.
 *
 * Monaco installs the reader from monaco-setup because importing monaco-editor here
 * would pull the whole editor bundle into the store chunk. Registering from this leaf
 * keeps the key present (zeroed) when the editor never loaded, so a missing key means
 * the instrument never ran rather than "no file was opened".
 */
import { registerRendererMemoryProfileContributor } from './renderer-memory-profile'

/** `chars` is UTF-16 code units, not bytes — CJK and emoji under-report up to 3x. */
export type MonacoModelCensus = { models: number; chars: number; lines: number }

const EMPTY_CENSUS: MonacoModelCensus = { models: 0, chars: 0, lines: 0 }

let readModels: (() => MonacoModelCensus) | null = null

export function setMonacoModelCensusReader(read: () => MonacoModelCensus): void {
  readModels = read
}

export function readMonacoModelCensus(): MonacoModelCensus {
  return readModels?.() ?? EMPTY_CENSUS
}

registerRendererMemoryProfileContributor('monacoModels', readMonacoModelCensus)
