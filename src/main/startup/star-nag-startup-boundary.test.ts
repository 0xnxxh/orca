import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/star-nag-startup-capability')"
const capabilityFactory = 'starNag = await createStarNagStartupCapability(store, stats)'

describe('star nag startup boundary', () => {
  it('keeps the service implementation out of the eager main graph', () => {
    const serviceImport = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .find(
        (declaration) =>
          (declaration.moduleSpecifier as ts.StringLiteral).text === './star-nag/service'
      )

    expect(serviceImport?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new StarNagService(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('starts and registers the service before later attachments and readiness', () => {
    const importIndex = source.indexOf(capabilityImport)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const agentBrowserIndex = source.indexOf(
      "await import('./startup/agent-browser-startup-capability')",
      factoryIndex
    )
    const emulatorIndex = source.indexOf(
      "await import('./startup/emulator-startup-capability')",
      agentBrowserIndex
    )
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(agentBrowserIndex).toBeGreaterThan(factoryIndex)
    expect(emulatorIndex).toBeGreaterThan(agentBrowserIndex)
    expect(initializedIndex).toBeGreaterThan(emulatorIndex)
  })

  it('preserves the committed will-quit stop contract', () => {
    const willQuitIndex = source.indexOf("app.on('will-quit'")
    const stopIndex = source.indexOf('starNag?.stop()', willQuitIndex)

    expect(willQuitIndex).toBeGreaterThanOrEqual(0)
    expect(stopIndex).toBeGreaterThan(willQuitIndex)
    expect(source.split('starNag?.stop()')).toHaveLength(2)
  })
})
