import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/stats-collector-startup-capability')"
const capabilityFactory = 'stats = await createStatsCollectorStartupCapability()'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('StatsCollector startup boundary', () => {
  it('keeps only the path capture in the eager main graph', () => {
    expect(findImport('./stats/collector')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./stats/stats-file-path')?.importClause?.isTypeOnly).toBe(false)
    expect(source).not.toContain('new StatsCollector(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('captures the path before app naming and constructs at the original services point', () => {
    const dataPathIndex = source.indexOf('initDataPath()')
    const statsPathIndex = source.indexOf('initStatsPath()', dataPathIndex)
    const whenReadyIndex = source.indexOf('void app.whenReady()')
    const appNameIndex = source.indexOf('app.setName(', whenReadyIndex)
    const cohortIndex = source.indexOf('initOnboardingCohortClassifier(store)')
    const importIndex = source.indexOf(capabilityImport, cohortIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const usageIndex = source.indexOf('claudeUsage = new ClaudeUsageStore(store)', factoryIndex)
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(dataPathIndex).toBeGreaterThanOrEqual(0)
    expect(statsPathIndex).toBeGreaterThan(dataPathIndex)
    expect(whenReadyIndex).toBeGreaterThan(statsPathIndex)
    expect(appNameIndex).toBeGreaterThan(whenReadyIndex)
    expect(importIndex).toBeGreaterThan(cohortIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(usageIndex).toBeGreaterThan(factoryIndex)
    expect(initializedIndex).toBeGreaterThan(usageIndex)
  })

  it('preserves singleton consumers and the committed flush lifecycle', () => {
    const runtimeIndex = source.indexOf('new OrcaRuntimeService(store, stats, {')
    const starNagIndex = source.indexOf('createStarNagStartupCapability(store, stats)')
    const handlersIndex = source.indexOf('registerCoreHandlers(')
    const willQuitIndex = source.indexOf("app.on('will-quit'")
    const flushIndex = source.indexOf('stats?.flush()', willQuitIndex)
    const killIndex = source.indexOf('killAllPty()', flushIndex)

    expect(runtimeIndex).toBeGreaterThanOrEqual(0)
    expect(starNagIndex).toBeGreaterThan(runtimeIndex)
    expect(handlersIndex).toBeGreaterThanOrEqual(0)
    expect(flushIndex).toBeGreaterThan(willQuitIndex)
    expect(killIndex).toBeGreaterThan(flushIndex)
    expect(source.split('stats?.flush()')).toHaveLength(2)
  })
})
