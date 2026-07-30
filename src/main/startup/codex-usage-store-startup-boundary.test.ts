import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/codex-usage-store-startup-capability')"
const capabilityFactory = 'codexUsage = await createCodexUsageStoreStartupCapability(store)'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('Codex usage store startup boundary', () => {
  it('keeps only the path capture in the eager main graph', () => {
    expect(findImport('./codex-usage/store')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./codex-usage/codex-usage-file-path')?.importClause?.isTypeOnly).toBe(false)
    expect(source).not.toContain('new CodexUsageStore(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('captures the path before app naming and constructs at the former services point', () => {
    const dataPathIndex = source.indexOf('initDataPath()')
    const usagePathIndex = source.indexOf('initCodexUsagePath()', dataPathIndex)
    const whenReadyIndex = source.indexOf('void app.whenReady()')
    const appNameIndex = source.indexOf('app.setName(', whenReadyIndex)
    const claudeUsageIndex = source.indexOf(
      'claudeUsage = await createClaudeUsageStoreStartupCapability(store)'
    )
    const importIndex = source.indexOf(capabilityImport, claudeUsageIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const openCodeUsageIndex = source.indexOf(
      "await import('./startup/opencode-usage-store-startup-capability')",
      factoryIndex
    )
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(dataPathIndex).toBeGreaterThanOrEqual(0)
    expect(usagePathIndex).toBeGreaterThan(dataPathIndex)
    expect(whenReadyIndex).toBeGreaterThan(usagePathIndex)
    expect(appNameIndex).toBeGreaterThan(whenReadyIndex)
    expect(importIndex).toBeGreaterThan(claudeUsageIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(openCodeUsageIndex).toBeGreaterThan(factoryIndex)
    expect(initializedIndex).toBeGreaterThan(openCodeUsageIndex)
  })

  it('preserves readiness, core-handler identity, and automation injection order', () => {
    expect(source).toContain(
      "throw new Error('Codex usage store must be initialized before opening the main window')"
    )
    const handlersIndex = source.indexOf('registerCoreHandlers(')
    const factoryIndex = source.indexOf(capabilityFactory)
    const automationImportIndex = source.indexOf(
      "await import('./startup/automation-service-startup-capability')",
      factoryIndex
    )
    const automationFactoryIndex = source.indexOf(
      'automations = await createAutomationServiceStartupCapability(store, {',
      automationImportIndex
    )
    const automationClaudeUsageIndex = source.indexOf('claudeUsage,', automationFactoryIndex)
    const automationCodexUsageIndex = source.indexOf('codexUsage,', automationClaudeUsageIndex)

    expect(handlersIndex).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('codexUsage,', handlersIndex)).toBeGreaterThan(handlersIndex)
    expect(automationImportIndex).toBeGreaterThan(factoryIndex)
    expect(automationFactoryIndex).toBeGreaterThan(automationImportIndex)
    expect(automationClaudeUsageIndex).toBeGreaterThan(automationFactoryIndex)
    expect(automationCodexUsageIndex).toBeGreaterThan(automationClaudeUsageIndex)
    expect(source.indexOf("logStartupMilestone('services-initialized')")).toBeGreaterThan(
      automationCodexUsageIndex
    )
  })
})
