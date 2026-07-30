import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/agent-browser-startup-capability')"

describe('agent browser startup boundary', () => {
  it('keeps the bridge implementation out of the eager main graph', () => {
    const staticImports = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .map((declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text)

    expect(staticImports).not.toContain('./browser/agent-browser-bridge')
    expect(source).not.toContain('new AgentBrowserBridge(')
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('attaches the bridge before services are observable', () => {
    const importIndex = source.indexOf(capabilityImport)
    const attachIndex = source.indexOf(
      'attachAgentBrowserStartupCapability(runtimeService, browserManager)',
      importIndex
    )
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(attachIndex).toBeGreaterThan(importIndex)
    expect(initializedIndex).toBeGreaterThan(attachIndex)
  })
})
