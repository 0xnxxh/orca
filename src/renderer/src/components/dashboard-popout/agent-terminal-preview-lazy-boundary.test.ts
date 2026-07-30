import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const dialogSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/dashboard-popout/AgentTerminalDialog.tsx'),
  'utf8'
)
const boardSource = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx'),
  'utf8'
)
const sourceFile = ts.createSourceFile(
  'AgentTerminalDialog.tsx',
  dialogSource,
  ts.ScriptTarget.Latest,
  false,
  ts.ScriptKind.TSX
)

describe('agent terminal preview lazy boundary', () => {
  it('keeps the terminal graph outside the dashboard shell static imports', () => {
    const staticImports = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .map((declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text)

    expect(staticImports).not.toContain('./AgentTerminalPreview')
    expect(boardSource).not.toContain('AgentTerminalPreview')
    expect(boardSource).toContain("from './AgentTerminalDialog'")
  })

  it('loads the preview through the resilient boundary only for a live PTY', () => {
    expect(dialogSource).toContain("import { lazyWithRetry } from '@/lib/lazy-with-retry'")
    expect(dialogSource).toContain("import('./AgentTerminalPreview')")
    expect(dialogSource).toContain("{ reloadKey: 'dashboard-agent-terminal-preview' }")
    expect(dialogSource).toContain('{card.ptyId ? (')
    expect(dialogSource).toContain(
      '<AgentTerminalPreview ptyId={card.ptyId} terminalInput={card.terminalInput ?? null} />'
    )
  })
})
