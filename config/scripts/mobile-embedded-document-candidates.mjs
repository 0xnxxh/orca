// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

const EMBEDDED_DOCUMENT_FILE_RE = /(?:-html|webview-html)\.[cm]?[jt]sx?$/
const USER_VISIBLE_ATTRIBUTE_RE =
  /\b(aria-description|aria-label|alt|data-placeholder|placeholder|title)\s*=\s*(["'])(.*?)\2/gi
const USER_VISIBLE_PROMPT_RE = /\b(?:window\.)?(alert|confirm|prompt)\(\s*(["'])(.*?)\2/g
const INSERTED_HTML_RE =
  /\bexecCommand\(\s*(["'])insertHTML\1\s*,\s*false\s*,\s*(["'])([\s\S]*?)\2\s*\)/g

function maskNonMarkupContent(documentText) {
  return documentText.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (value) =>
    value.replace(/[^\n]/g, ' ')
  )
}

function capturedOffset(match, capturedValue) {
  return (match.index ?? 0) + match[0].indexOf(capturedValue)
}

function collectMarkupCandidates(markup, baseOffset, candidates) {
  for (const match of markup.matchAll(USER_VISIBLE_ATTRIBUTE_RE)) {
    const value = match[3]
    if (!value.includes('${')) {
      const start = baseOffset + capturedOffset(match, value)
      candidates.push({
        start,
        end: start + value.length,
        kind: `embedded-html-attribute:${match[1].toLowerCase()}`,
        text: value,
        dynamic: false
      })
    }
  }

  for (const match of markup.matchAll(/>([^<]+)</g)) {
    const value = match[1]
    if (!value.includes('${')) {
      const start = baseOffset + capturedOffset(match, value)
      candidates.push({
        start,
        end: start + value.length,
        kind: 'embedded-html-text',
        text: value,
        dynamic: false
      })
    }
  }
}

export function collectMobileEmbeddedDocumentCandidates(filePath, sourceText) {
  if (!EMBEDDED_DOCUMENT_FILE_RE.test(filePath)) {
    return []
  }

  const sourceKind =
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourceKind
  )
  const candidates = []

  function visit(node) {
    if (
      (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /<!doctype html/i.test(node.getText(sourceFile))
    ) {
      const documentText = node.getText(sourceFile).slice(1, -1)
      const baseOffset = node.getStart(sourceFile) + 1
      collectMarkupCandidates(maskNonMarkupContent(documentText), baseOffset, candidates)

      for (const match of documentText.matchAll(USER_VISIBLE_PROMPT_RE)) {
        const value = match[3]
        const start = baseOffset + capturedOffset(match, value)
        candidates.push({
          start,
          end: start + value.length,
          kind: `embedded-web-${match[1].toLowerCase()}`,
          text: value,
          dynamic: false
        })
      }

      for (const match of documentText.matchAll(INSERTED_HTML_RE)) {
        const markup = match[3]
        const markupOffset = baseOffset + capturedOffset(match, markup)
        collectMarkupCandidates(markup, markupOffset, candidates)
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return candidates
}
