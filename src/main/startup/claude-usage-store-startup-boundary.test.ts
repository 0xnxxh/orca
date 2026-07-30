import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/claude-usage-store-startup-capability')"
const capabilityFactory = 'claudeUsage = await createClaudeUsageStoreStartupCapability(store)'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('Claude usage store startup boundary', () => {
  it('keeps only the path capture in the eager main graph', () => {
    expect(findImport('./claude-usage/store')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./claude-usage/claude-usage-file-path')?.importClause?.isTypeOnly).toBe(
      false
    )
    expect(source).not.toContain('new ClaudeUsageStore(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('captures the path before app naming and constructs at the former services point', () => {
    const dataPathIndex = source.indexOf('initDataPath()')
    const usagePathIndex = source.indexOf('initClaudeUsagePath()', dataPathIndex)
    const whenReadyIndex = source.indexOf('void app.whenReady()')
    const appNameIndex = source.indexOf('app.setName(', whenReadyIndex)
    const statsIndex = source.indexOf('stats = await createStatsCollectorStartupCapability()')
    const importIndex = source.indexOf(capabilityImport, statsIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const codexUsageIndex = source.indexOf('codexUsage = new CodexUsageStore(store)', factoryIndex)
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(dataPathIndex).toBeGreaterThanOrEqual(0)
    expect(usagePathIndex).toBeGreaterThan(dataPathIndex)
    expect(whenReadyIndex).toBeGreaterThan(usagePathIndex)
    expect(appNameIndex).toBeGreaterThan(whenReadyIndex)
    expect(importIndex).toBeGreaterThan(statsIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(codexUsageIndex).toBeGreaterThan(factoryIndex)
    expect(initializedIndex).toBeGreaterThan(codexUsageIndex)
  })

  it('preserves readiness, core-handler identity, and automation injection order', () => {
    expect(source).toContain(
      "throw new Error('Claude usage store must be initialized before opening the main window')"
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

    expect(handlersIndex).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('claudeUsage,', handlersIndex)).toBeGreaterThan(handlersIndex)
    expect(automationImportIndex).toBeGreaterThan(factoryIndex)
    expect(automationFactoryIndex).toBeGreaterThan(automationImportIndex)
    expect(automationClaudeUsageIndex).toBeGreaterThan(automationFactoryIndex)
    expect(automationClaudeUsageIndex).toBeLessThan(
      source.indexOf('codexUsage,', automationClaudeUsageIndex)
    )
    expect(source.indexOf("logStartupMilestone('services-initialized')")).toBeGreaterThan(
      automationClaudeUsageIndex
    )
  })
})
