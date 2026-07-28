import { Button } from '@renderer/components/ui/button'
import { Code, Eye } from 'lucide-react'
import React, { useState } from 'react'
import type { MobileWebFileDocument } from './mobile-web-file-document'
import { buildMobileWebFileSyntax, type MobileWebSyntaxKind } from './mobile-web-file-syntax'
import { MobileWebInertMarkdown } from './mobile-web-inert-markdown'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])

export function MobileWebFileTextPreview({
  document
}: {
  document: MobileWebFileDocument
}): React.JSX.Element {
  const markdown = isMobileWebMarkdownPath(document.relativePath)
  const [mode, setMode] = useState<'preview' | 'source'>(() => (markdown ? 'preview' : 'source'))

  if (!markdown) {
    return (
      <MobileWebFileSourcePreview relativePath={document.relativePath} content={document.content} />
    )
  }

  return (
    <div className="border-t border-border">
      <div
        className="flex items-center gap-2 border-b border-border px-6 py-2"
        aria-label="Markdown view"
      >
        <Button
          variant={mode === 'preview' ? 'secondary' : 'ghost'}
          size="xs"
          aria-pressed={mode === 'preview'}
          onClick={() => setMode('preview')}
        >
          <Eye />
          Preview
        </Button>
        <Button
          variant={mode === 'source' ? 'secondary' : 'ghost'}
          size="xs"
          aria-pressed={mode === 'source'}
          onClick={() => setMode('source')}
        >
          <Code />
          Source
        </Button>
      </div>
      {mode === 'preview' ? (
        <article
          aria-label={`Rendered Markdown preview of ${document.relativePath}`}
          className="max-h-96 overflow-auto bg-[var(--editor-surface)] px-6 py-4 text-sm scrollbar-editor"
        >
          <MobileWebInertMarkdown content={document.content} />
        </article>
      ) : (
        <MobileWebFileSourcePreview
          relativePath={document.relativePath}
          content={document.content}
          border={false}
        />
      )}
    </div>
  )
}

export function isMobileWebMarkdownPath(relativePath: string): boolean {
  const basename = relativePath.split(/[\\/]/).at(-1) ?? ''
  const extension = basename.includes('.') ? basename.split('.').at(-1)?.toLowerCase() : ''
  return extension ? MARKDOWN_EXTENSIONS.has(extension) : false
}

function MobileWebFileSourcePreview({
  relativePath,
  content,
  border = true
}: {
  relativePath: string
  content: string
  border?: boolean
}): React.JSX.Element {
  const syntax = buildMobileWebFileSyntax(relativePath, content)
  return (
    <pre
      aria-label="File source preview"
      className={`max-h-96 overflow-auto whitespace-pre-wrap break-words bg-[var(--editor-surface)] p-4 font-mono text-xs scrollbar-editor ${
        border ? 'border-t border-border' : ''
      }`}
    >
      {syntax.segments.map((segment, index) => (
        <span
          key={`${index}-${segment.kind}`}
          data-syntax-kind={segment.kind}
          className={syntaxClassName(segment.kind)}
        >
          {segment.text}
        </span>
      ))}
    </pre>
  )
}

function syntaxClassName(kind: MobileWebSyntaxKind): string | undefined {
  if (kind === 'comment') {
    return 'text-muted-foreground italic'
  }
  if (kind === 'keyword' || kind === 'type') {
    return 'font-semibold'
  }
  if (kind === 'function' || kind === 'meta') {
    return 'font-medium underline decoration-border'
  }
  if (kind === 'variable') {
    return 'font-medium'
  }
  if (kind === 'string') {
    return 'text-muted-foreground'
  }
  if (kind === 'number') {
    return 'tabular-nums'
  }
  return undefined
}
