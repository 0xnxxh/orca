import { Image as ImageIcon } from 'lucide-react'
import { Lexer, type Token, type Tokens } from 'marked'
import React from 'react'

export const MOBILE_WEB_MARKDOWN_PREVIEW_MAX_CHARACTERS = 128 * 1024
export const MOBILE_WEB_MARKDOWN_PREVIEW_MAX_NODES = 4_000

type RenderBudget = {
  remaining: number
  exhausted: boolean
}

export function MobileWebInertMarkdown({ content }: { content: string }): React.JSX.Element {
  const boundedContent = content.slice(0, MOBILE_WEB_MARKDOWN_PREVIEW_MAX_CHARACTERS)
  const tokens = Lexer.lex(boundedContent, { gfm: true })
  const budget: RenderBudget = {
    remaining: MOBILE_WEB_MARKDOWN_PREVIEW_MAX_NODES,
    exhausted: false
  }

  return (
    <>
      {renderTokens(tokens, budget, 'document')}
      {content.length > boundedContent.length || budget.exhausted ? (
        <p role="status" className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          Rendered preview stopped at the mobile Markdown limit. Source view retains the loaded
          text.
        </p>
      ) : null}
    </>
  )
}

function renderTokens(tokens: Token[], budget: RenderBudget, keyPrefix: string): React.ReactNode[] {
  const result: React.ReactNode[] = []
  for (const [index, token] of tokens.entries()) {
    const node = renderToken(token, budget, `${keyPrefix}-${index}`)
    if (node !== null) {
      result.push(node)
    }
    if (budget.exhausted) {
      break
    }
  }
  return result
}

function renderToken(token: Token, budget: RenderBudget, key: string): React.ReactNode {
  if (token.type === 'space' || token.type === 'def' || token.type === 'html') {
    return null
  }
  if (!reserveNode(budget)) {
    return null
  }

  switch (token.type) {
    case 'heading':
      return renderHeading(token as Tokens.Heading, budget, key)
    case 'paragraph':
      return (
        <p key={key} className="my-3 break-words leading-6 first:mt-0 last:mb-0">
          {renderTokens((token as Tokens.Paragraph).tokens, budget, key)}
        </p>
      )
    case 'text': {
      const text = token as Tokens.Text
      return (
        <React.Fragment key={key}>
          {text.tokens ? renderTokens(text.tokens, budget, key) : text.text}
        </React.Fragment>
      )
    }
    case 'escape':
      return <React.Fragment key={key}>{(token as Tokens.Escape).text}</React.Fragment>
    case 'strong':
      return (
        <strong key={key} className="font-semibold">
          {renderTokens((token as Tokens.Strong).tokens, budget, key)}
        </strong>
      )
    case 'em':
      return <em key={key}>{renderTokens((token as Tokens.Em).tokens, budget, key)}</em>
    case 'del':
      return <del key={key}>{renderTokens((token as Tokens.Del).tokens, budget, key)}</del>
    case 'codespan':
      return (
        <code key={key} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
          {(token as Tokens.Codespan).text}
        </code>
      )
    case 'code':
      return (
        <pre
          key={key}
          className="my-3 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs scrollbar-editor"
        >
          <code>{(token as Tokens.Code).text}</code>
        </pre>
      )
    case 'blockquote':
      return (
        <blockquote key={key} className="my-3 border-l-2 border-border pl-4 text-muted-foreground">
          {renderTokens((token as Tokens.Blockquote).tokens, budget, key)}
        </blockquote>
      )
    case 'list':
      return renderList(token as Tokens.List, budget, key)
    case 'table':
      return renderTable(token as Tokens.Table, budget, key)
    case 'link':
      return (
        <span key={key} className="font-medium underline decoration-border">
          {renderTokens((token as Tokens.Link).tokens, budget, key)}
        </span>
      )
    case 'image':
      return renderImage(token as Tokens.Image, key)
    case 'br':
      return <br key={key} />
    case 'hr':
      return <hr key={key} className="my-4 border-border" />
    case 'checkbox':
      return (
        <input
          key={key}
          type="checkbox"
          checked={(token as Tokens.Checkbox).checked}
          readOnly
          disabled
          className="mr-2 align-middle"
        />
      )
    default: {
      const children = childTokens(token)
      return children ? (
        <React.Fragment key={key}>{renderTokens(children, budget, key)}</React.Fragment>
      ) : null
    }
  }
}

function renderHeading(token: Tokens.Heading, budget: RenderBudget, key: string): React.ReactNode {
  const children = renderTokens(token.tokens, budget, key)
  if (token.depth === 1) {
    return (
      <h1 key={key} className="mb-3 mt-5 text-2xl font-semibold first:mt-0">
        {children}
      </h1>
    )
  }
  if (token.depth === 2) {
    return (
      <h2 key={key} className="mb-2 mt-5 text-xl font-semibold first:mt-0">
        {children}
      </h2>
    )
  }
  if (token.depth === 3) {
    return (
      <h3 key={key} className="mb-2 mt-4 text-lg font-semibold first:mt-0">
        {children}
      </h3>
    )
  }
  return (
    <h4 key={key} className="mb-2 mt-4 text-base font-semibold">
      {children}
    </h4>
  )
}

function renderList(token: Tokens.List, budget: RenderBudget, key: string): React.ReactNode {
  const items: React.ReactNode[] = []
  for (const [index, item] of token.items.entries()) {
    if (!reserveNode(budget)) {
      break
    }
    items.push(
      <li key={`${key}-${index}`} className="pl-1">
        {item.task ? (
          <input
            type="checkbox"
            checked={item.checked === true}
            readOnly
            disabled
            className="mr-2 align-middle"
          />
        ) : null}
        {renderTokens(item.tokens, budget, `${key}-${index}`)}
      </li>
    )
  }
  return token.ordered ? (
    <ol key={key} className="my-3 list-decimal space-y-1 pl-5">
      {items}
    </ol>
  ) : (
    <ul key={key} className="my-3 list-disc space-y-1 pl-5">
      {items}
    </ul>
  )
}

function renderTable(token: Tokens.Table, budget: RenderBudget, key: string): React.ReactNode {
  const headerCells = reserveNode(budget)
    ? renderTableCells(token.header, budget, `${key}-header`, true)
    : []
  const rows: React.ReactNode[] = []
  for (const [rowIndex, row] of token.rows.entries()) {
    if (!reserveNode(budget)) {
      break
    }
    rows.push(
      <tr key={`${key}-row-${rowIndex}`}>
        {renderTableCells(row, budget, `${key}-row-${rowIndex}`, false)}
      </tr>
    )
  }
  return (
    <table key={key} className="my-3 w-full border-collapse text-left text-xs">
      <thead>
        <tr>{headerCells}</tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  )
}

function renderTableCells(
  cells: Tokens.TableCell[],
  budget: RenderBudget,
  key: string,
  header: boolean
): React.ReactNode[] {
  const result: React.ReactNode[] = []
  for (const [index, cell] of cells.entries()) {
    if (!reserveNode(budget)) {
      break
    }
    const children = renderTokens(cell.tokens, budget, `${key}-${index}`)
    result.push(
      header ? (
        <th
          key={`${key}-${index}`}
          className="border border-border bg-muted px-2 py-1.5 font-semibold"
        >
          {children}
        </th>
      ) : (
        <td key={`${key}-${index}`} className="border border-border px-2 py-1.5">
          {children}
        </td>
      )
    )
  }
  return result
}

function renderImage(token: Tokens.Image, key: string): React.ReactNode {
  const label = token.text ? `Image: ${token.text}` : 'Image omitted from Markdown preview'
  return (
    <span
      key={key}
      role="img"
      aria-label={token.text ? `Image: ${token.text}` : 'Markdown image'}
      className="my-3 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
    >
      <ImageIcon className="size-4" />
      {label}
    </span>
  )
}

function reserveNode(budget: RenderBudget): boolean {
  if (budget.remaining <= 0) {
    budget.exhausted = true
    return false
  }
  budget.remaining -= 1
  return true
}

function childTokens(token: Token): Token[] | null {
  const candidate = token as { tokens?: unknown }
  return Array.isArray(candidate.tokens) ? (candidate.tokens as Token[]) : null
}
