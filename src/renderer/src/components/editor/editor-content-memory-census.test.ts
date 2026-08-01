import { describe, expect, it } from 'vitest'
import { collectRendererMemoryProfileCounts } from '../../lib/renderer-memory-profile'
import {
  measureEditorFileContents,
  registerEditorContentCensusReader
} from './editor-content-memory-census'

describe('measureEditorFileContents', () => {
  it('counts entries and total characters of the loaded file bodies', () => {
    expect(
      measureEditorFileContents({
        a: { content: 'abc', isBinary: false },
        b: { content: 'de', isBinary: false }
      })
    ).toEqual({ files: 2, chars: 5 })
  })

  it('tolerates an entry with no content string', () => {
    expect(
      measureEditorFileContents({
        a: { content: undefined as unknown as string, isBinary: true }
      })
    ).toEqual({ files: 1, chars: 0 })
  })
})

describe('editor content memory profile contributor', () => {
  it('reports React-held file bodies, which the store-only profile cannot see', () => {
    // Why: crash bundles show gigabytes retained with every store collection
    // count unchanged. File contents live in useState, outside that profile.
    const release = registerEditorContentCensusReader(() => ({ files: 3, chars: 4_000_000 }))

    expect(collectRendererMemoryProfileCounts()).toMatchObject({
      'editorContent.panels': 1,
      'editorContent.files': 3,
      'editorContent.chars': 4_000_000
    })

    release()
    expect(collectRendererMemoryProfileCounts()).toMatchObject({
      'editorContent.panels': 0,
      'editorContent.files': 0,
      'editorContent.chars': 0
    })
  })

  it('sums every mounted panel so a split editor is not undercounted', () => {
    const releaseA = registerEditorContentCensusReader(() => ({ files: 2, chars: 100 }))
    const releaseB = registerEditorContentCensusReader(() => ({ files: 5, chars: 900 }))

    expect(collectRendererMemoryProfileCounts()).toMatchObject({
      'editorContent.panels': 2,
      'editorContent.files': 7,
      'editorContent.chars': 1000
    })

    releaseA()
    releaseB()
  })
})
