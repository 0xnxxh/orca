import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/opencode-usage-store-startup-capability')"
const capabilityFactory = 'openCodeUsage = await createOpenCodeUsageStoreStartupCapability(store)'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('OpenCode usage store startup boundary', () => {
  it('keeps only the path capture in the eager main graph', () => {
    expect(findImport('./opencode-usage/store')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./opencode-usage/opencode-usage-file-path')?.importClause?.isTypeOnly).toBe(
      false
    )
    expect(source).not.toContain('new OpenCodeUsageStore(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('captures the path before app naming and constructs at the former services point', () => {
    const dataPathIndex = source.indexOf('initDataPath()')
    const usagePathIndex = source.indexOf('initOpenCodeUsagePath()', dataPathIndex)
    const whenReadyIndex = source.indexOf('void app.whenReady()')
    const appNameIndex = source.indexOf('app.setName(', whenReadyIndex)
    const codexUsageIndex = source.indexOf('codexUsage = new CodexUsageStore(store)')
    const importIndex = source.indexOf(capabilityImport, codexUsageIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const rateLimitsIndex = source.indexOf('rateLimits = new RateLimitService()', factoryIndex)
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(dataPathIndex).toBeGreaterThanOrEqual(0)
    expect(usagePathIndex).toBeGreaterThan(dataPathIndex)
    expect(whenReadyIndex).toBeGreaterThan(usagePathIndex)
    expect(appNameIndex).toBeGreaterThan(whenReadyIndex)
    expect(importIndex).toBeGreaterThan(codexUsageIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(rateLimitsIndex).toBeGreaterThan(factoryIndex)
    expect(initializedIndex).toBeGreaterThan(rateLimitsIndex)
  })

  it('preserves the readiness guard and core-handler singleton identity', () => {
    expect(source).toContain(
      "throw new Error('OpenCode usage store must be initialized before opening the main window')"
    )
    const handlersStart = source.indexOf('registerCoreHandlers(')
    const handlersEnd = source.indexOf(
      ')',
      source.indexOf('pluginMarketplaceService', handlersStart)
    )
    const handlersSource = source.slice(handlersStart, handlersEnd)

    expect(handlersStart).toBeGreaterThanOrEqual(0)
    expect(handlersEnd).toBeGreaterThan(handlersStart)
    expect(handlersSource).toContain('openCodeUsage,')
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })
})
