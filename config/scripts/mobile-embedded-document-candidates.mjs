// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

const EMBEDDED_DOCUMENT_FILE_RE = /(?:-html|webview-html)\.[cm]?[jt]sx?$/
const USER_VISIBLE_ATTRIBUTE_RE =
  /\b(aria-description|aria-label|alt|data-placeholder|placeholder|title)\s*=\s*(["'])(.*?)\2/gi
const USER_VISIBLE_PROMPT_RE = /\b(?:window\.)?(alert|confirm|prompt)\(\s*(["'])(.*?)\2/g
const INSERTED_HTML_CALL_RE = /\bexecCommand\(\s*(["'])insertHTML\1\s*,\s*false\s*,/g

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

function collectMarkupFragmentCandidates(markup, baseOffset, candidates) {
  collectMarkupCandidates(markup, baseOffset, candidates)

  for (const match of [markup.match(/^([^<]+)</), markup.match(/>([^<]+)$/)]) {
    if (!match) {
      continue
    }
    const value = match[1]
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

function skipQuotedString(source, start) {
  const quote = source[start]
  let cursor = start + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2
    } else if (source[cursor] === quote) {
      return cursor + 1
    } else {
      cursor += 1
    }
  }
  return source.length
}

function skipTemplateInterpolation(source, start) {
  let depth = 1
  let cursor = start + 2
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = skipQuotedString(source, cursor)
    } else {
      if (source[cursor] === '{') {
        depth += 1
      }
      if (source[cursor] === '}') {
        depth -= 1
      }
      cursor += 1
    }
  }
  return cursor
}

function insertedHtmlArgumentEnd(source, start) {
  let depth = 1
  let cursor = start
  while (cursor < source.length) {
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = skipQuotedString(source, cursor)
      continue
    }
    if (source[cursor] === '(') {
      depth += 1
    }
    if (source[cursor] === ')') {
      depth -= 1
      if (depth === 0) {
        return cursor
      }
    }
    cursor += 1
  }
  return source.length
}

function collectInsertedHtmlCandidates(expression, baseOffset, candidates) {
  let cursor = 0
  while (cursor < expression.length) {
    if (expression.startsWith('${', cursor)) {
      cursor = skipTemplateInterpolation(expression, cursor)
      continue
    }
    if (expression[cursor] === '"' || expression[cursor] === "'") {
      const end = skipQuotedString(expression, cursor)
      const markup = expression.slice(cursor + 1, end - 1)
      collectMarkupFragmentCandidates(markup, baseOffset + cursor + 1, candidates)
      cursor = end
      continue
    }
    cursor += 1
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

      for (const match of documentText.matchAll(INSERTED_HTML_CALL_RE)) {
        const argumentStart = (match.index ?? 0) + match[0].length
        const argumentEnd = insertedHtmlArgumentEnd(documentText, argumentStart)
        collectInsertedHtmlCandidates(
          documentText.slice(argumentStart, argumentEnd),
          baseOffset + argumentStart,
          candidates
        )
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return candidates
}
