import { describe, expect, it } from 'vitest'
import { canOpenDiffSectionPreviewToSide } from './diff-section-preview'

describe('canOpenDiffSectionPreviewToSide', () => {
  it('enables HTML working-tree sections that still exist on disk', () => {
    expect(
      canOpenDiffSectionPreviewToSide({
        path: 'docs/demo.html',
        status: 'modified',
        isCommitSurface: false
      })
    ).toBe(true)
  })

  it('enables .htm paths', () => {
    expect(
      canOpenDiffSectionPreviewToSide({
        path: 'index.htm',
        status: 'added',
        isCommitSurface: false
      })
    ).toBe(true)
  })

  it('disables deleted HTML files', () => {
    expect(
      canOpenDiffSectionPreviewToSide({
        path: 'gone.html',
        status: 'deleted',
        isCommitSurface: false
      })
    ).toBe(false)
  })

  it('disables commit surfaces whose content may not match disk', () => {
    expect(
      canOpenDiffSectionPreviewToSide({
        path: 'docs/demo.html',
        status: 'modified',
        isCommitSurface: true
      })
    ).toBe(false)
  })

  it('disables non-previewable languages', () => {
    expect(
      canOpenDiffSectionPreviewToSide({
        path: 'src/app.ts',
        status: 'modified',
        isCommitSurface: false
      })
    ).toBe(false)
  })
})
