// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MobileWebFileDocument } from './mobile-web-file-document'
import { isMobileWebMarkdownPath, MobileWebFileTextPreview } from './mobile-web-file-text-preview'
import { MOBILE_WEB_MARKDOWN_PREVIEW_MAX_NODES } from './mobile-web-inert-markdown'

afterEach(cleanup)

describe('MobileWebFileTextPreview', () => {
  it('classifies supported Markdown paths without treating other dotted files as Markdown', () => {
    expect(isMobileWebMarkdownPath('README.MD')).toBe(true)
    expect(isMobileWebMarkdownPath('docs/plan.markdown')).toBe(true)
    expect(isMobileWebMarkdownPath('src/markdown.ts')).toBe(false)
    expect(isMobileWebMarkdownPath('.markdownlint.json')).toBe(false)
  })

  it('renders GFM while dropping raw HTML and all repository-controlled navigation targets', () => {
    const view = render(
      createElement(MobileWebFileTextPreview, {
        document: fileDocument(
          'README.md',
          [
            '# Safe preview',
            '',
            '| State | Value |',
            '| --- | --- |',
            '| Ready | yes |',
            '',
            '[External](https://example.com/path)',
            '![Secret](https://example.com/secret.png)',
            '<script>window.pwned = true</script>',
            '<iframe src="https://example.com"></iframe>'
          ].join('\n')
        )
      })
    )

    expect(screen.getByRole('heading', { name: 'Safe preview' })).toBeDefined()
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.getByText('External')).toBeDefined()
    expect(screen.getByLabelText('Image: Secret')).toBeDefined()
    expect(view.container.querySelector('a')).toBeNull()
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(view.container.querySelector('[href], [src]')).toBeNull()
  })

  it('switches between rendered Markdown and inert source without executing source HTML', () => {
    const source = '# Heading\n\n<script>not executable</script>'
    const view = render(
      createElement(MobileWebFileTextPreview, {
        document: fileDocument('README.md', source)
      })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect(screen.getByLabelText('File source preview').textContent).toBe(source)
    expect(view.container.querySelector('script')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeDefined()
  })

  it('keeps non-Markdown source in an inert code surface', () => {
    const source = '<img src="https://example.com/tracker.png">'
    const view = render(
      createElement(MobileWebFileTextPreview, {
        document: fileDocument('src/app.ts', source)
      })
    )

    expect(screen.getByLabelText('File source preview').textContent).toBe(source)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('stops repository-controlled Markdown before it can create an unbounded document', () => {
    const headingCount = MOBILE_WEB_MARKDOWN_PREVIEW_MAX_NODES + 100
    const view = render(
      createElement(MobileWebFileTextPreview, {
        document: fileDocument(
          'large.md',
          Array.from({ length: headingCount }, () => '# x').join('\n')
        )
      })
    )

    expect(view.container.querySelectorAll('h1').length).toBeLessThan(headingCount)
    expect(screen.getByRole('status').textContent).toContain('mobile Markdown limit')
  })
})

function fileDocument(relativePath: string, content: string): MobileWebFileDocument {
  const bytes = new TextEncoder().encode(content)
  return {
    workspaceId: 'workspace-1',
    relativePath,
    bytes,
    content,
    kind: 'text',
    eof: true,
    limitReached: false,
    revision: 'a'.repeat(64)
  }
}
