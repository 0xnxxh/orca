import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'

export const MOBILE_WEB_SYNTAX_MAX_CHARACTERS = 48_000
export const MOBILE_WEB_SYNTAX_MAX_SEGMENTS = 3_000

export type MobileWebSyntaxKind =
  | 'plain'
  | 'comment'
  | 'keyword'
  | 'string'
  | 'number'
  | 'type'
  | 'function'
  | 'variable'
  | 'meta'

export type MobileWebSyntaxSegment = {
  text: string
  kind: MobileWebSyntaxKind
}

export type MobileWebFileSyntax = {
  language: string
  segments: MobileWebSyntaxSegment[]
  highlighted: boolean
}

type LowlightNode = {
  type: string
  value?: string
  properties?: { className?: unknown }
  children?: LowlightNode[]
}

const lowlight = createLowlight({
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  typescript,
  xml,
  yaml
})

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  css: 'css',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  markdown: 'markdown',
  md: 'markdown',
  mdown: 'markdown',
  mjs: 'javascript',
  mkd: 'markdown',
  py: 'python',
  sh: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash'
}

export function buildMobileWebFileSyntax(
  relativePath: string,
  content: string
): MobileWebFileSyntax {
  const language = mobileWebSyntaxLanguage(relativePath)
  if (language === 'plaintext' || content.length === 0) {
    return plainSyntax(language, content)
  }

  const highlightLength = highlightBoundary(content)
  try {
    const tree = lowlight.highlight(language, content.slice(0, highlightLength)) as LowlightNode
    const segments = mergeAdjacent(flattenNodes(tree.children ?? [], 'plain'))
    if (segments.length > MOBILE_WEB_SYNTAX_MAX_SEGMENTS) {
      return plainSyntax(language, content)
    }
    if (highlightLength < content.length) {
      appendSegment(segments, { text: content.slice(highlightLength), kind: 'plain' })
    }
    return { language, segments, highlighted: true }
  } catch {
    return plainSyntax(language, content)
  }
}

export function mobileWebSyntaxLanguage(relativePath: string): string {
  const basename = relativePath.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (basename === 'dockerfile' || basename === 'makefile') {
    return 'bash'
  }
  const extension = basename.includes('.') ? basename.split('.').at(-1) : undefined
  return extension ? (LANGUAGE_BY_EXTENSION[extension] ?? 'plaintext') : 'plaintext'
}

function highlightBoundary(content: string): number {
  if (content.length <= MOBILE_WEB_SYNTAX_MAX_CHARACTERS) {
    return content.length
  }
  const boundary = content.lastIndexOf('\n', MOBILE_WEB_SYNTAX_MAX_CHARACTERS)
  return boundary > 0 ? boundary + 1 : MOBILE_WEB_SYNTAX_MAX_CHARACTERS
}

function flattenNodes(
  nodes: LowlightNode[],
  inheritedKind: MobileWebSyntaxKind
): MobileWebSyntaxSegment[] {
  const segments: MobileWebSyntaxSegment[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      appendSegment(segments, { text: node.value ?? '', kind: inheritedKind })
      continue
    }
    if (node.type !== 'element') {
      continue
    }
    const kind = syntaxKind(node.properties?.className) ?? inheritedKind
    for (const segment of flattenNodes(node.children ?? [], kind)) {
      appendSegment(segments, segment)
    }
  }
  return segments
}

function syntaxKind(className: unknown): MobileWebSyntaxKind | null {
  const classes = Array.isArray(className)
    ? className.filter((value): value is string => typeof value === 'string')
    : typeof className === 'string'
      ? className.split(/\s+/)
      : []
  const values = new Set(classes.map((value) => value.replace(/^hljs-/, '')))
  if (hasAny(values, ['comment', 'quote'])) {
    return 'comment'
  }
  if (hasAny(values, ['keyword', 'selector-tag', 'tag', 'name'])) {
    return 'keyword'
  }
  if (hasAny(values, ['string', 'regexp', 'symbol', 'bullet'])) {
    return 'string'
  }
  if (hasAny(values, ['number', 'literal'])) {
    return 'number'
  }
  if (hasAny(values, ['type', 'built_in', 'class', 'title.class'])) {
    return 'type'
  }
  if (hasAny(values, ['title.function', 'function', 'title'])) {
    return 'function'
  }
  if (hasAny(values, ['attr', 'attribute', 'property', 'variable', 'params'])) {
    return 'variable'
  }
  if (hasAny(values, ['meta', 'doctag', 'subst', 'section'])) {
    return 'meta'
  }
  return null
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => values.has(candidate))
}

function mergeAdjacent(segments: MobileWebSyntaxSegment[]): MobileWebSyntaxSegment[] {
  const result: MobileWebSyntaxSegment[] = []
  for (const segment of segments) {
    appendSegment(result, segment)
  }
  return result
}

function appendSegment(segments: MobileWebSyntaxSegment[], segment: MobileWebSyntaxSegment): void {
  if (!segment.text) {
    return
  }
  const previous = segments.at(-1)
  if (previous?.kind === segment.kind) {
    previous.text += segment.text
    return
  }
  segments.push({ ...segment })
}

function plainSyntax(language: string, content: string): MobileWebFileSyntax {
  return {
    language,
    segments: [{ text: content, kind: 'plain' }],
    highlighted: false
  }
}
