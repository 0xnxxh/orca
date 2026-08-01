import { describe, expect, it } from 'vitest'
import { collectRendererMemoryProfileCounts } from './renderer-memory-profile'
import { readMonacoModelCensus, setMonacoModelCensusReader } from './monaco-model-memory-census'

describe('monaco model memory census', () => {
  it('reports zeros before monaco loads, so a missing key means the instrument never ran', () => {
    expect(readMonacoModelCensus()).toEqual({ models: 0, chars: 0, lines: 0 })
    expect(collectRendererMemoryProfileCounts()).toMatchObject({
      'monacoModels.models': 0,
      'monacoModels.chars': 0,
      'monacoModels.lines': 0
    })
  })

  it('surfaces models retained past their panel, which editorContent.chars reads as zero', () => {
    // Why: models live in monaco's global registry and are disposed only on tab
    // close, so an unmounted panel leaves its text fully retained and unmeasured.
    setMonacoModelCensusReader(() => ({ models: 214, chars: 91_324_887, lines: 2_140_000 }))

    expect(collectRendererMemoryProfileCounts()).toMatchObject({
      'monacoModels.models': 214,
      'monacoModels.chars': 91_324_887,
      'monacoModels.lines': 2_140_000
    })

    setMonacoModelCensusReader(() => ({ models: 0, chars: 0, lines: 0 }))
  })
})
