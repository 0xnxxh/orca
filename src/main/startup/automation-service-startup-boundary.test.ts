import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/automation-service-startup-capability')"
const capabilityFactory = 'automations = await createAutomationServiceStartupCapability(store, {'

describe('automation service startup boundary', () => {
  it('keeps the service implementation out of the eager main graph', () => {
    const serviceImport = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .find(
        (declaration) =>
          (declaration.moduleSpecifier as ts.StringLiteral).text === './automations/service'
      )

    expect(serviceImport?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new AutomationService(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('attaches the live instance before readiness without moving startup consumers', () => {
    const importIndex = source.indexOf(capabilityImport)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const attachmentIndex = source.indexOf('runtimeService.setAutomationService(automations)')
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(attachmentIndex).toBeGreaterThan(factoryIndex)
    expect(initializedIndex).toBeGreaterThan(attachmentIndex)
    const coreHandlersIndex = source.indexOf('registerCoreHandlers(')
    const webContentsIndex = source.indexOf('automations.setWebContents(window.webContents)')
    expect(webContentsIndex).toBeGreaterThan(coreHandlersIndex)
    expect(source.indexOf('automations.start()', webContentsIndex)).toBeGreaterThan(
      webContentsIndex
    )
  })

  it('preserves scheduling inputs, dispatch routing, and committed lifetime', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const attachmentIndex = source.indexOf('runtimeService.setAutomationService', factoryIndex)
    const constructionSource = source.slice(factoryIndex, attachmentIndex)

    expect(constructionSource).toContain('claudeUsage,')
    expect(constructionSource).toContain('codexUsage,')
    expect(constructionSource).toContain('allowRemoteHostScheduling: isServeMode')
    expect(constructionSource).toContain('headlessDispatcher: isServeMode')
    expect(constructionSource).toContain("automation.workspaceMode === 'new_per_run'")
    expect(constructionSource).toContain('runtimeService.createManagedWorktree')
    expect(constructionSource).toContain('runtimeService.launchAgentTerminal')
    expect(constructionSource).toContain('runtimeService.waitForTerminal')
    expect(constructionSource).toContain('runtimeService.readTerminal')
    expect(constructionSource).toContain("status: 'completed' as const")
    expect(constructionSource).toContain("status: 'dispatch_failed' as const")
    expect(
      source.indexOf('automations.start()', source.indexOf('if (serveOptions)'))
    ).toBeGreaterThan(
      source.indexOf('await runtimeRpc.start()', source.indexOf('if (serveOptions)'))
    )
    expect(source.split('automations?.stop()')).toHaveLength(2)
    expect(source.indexOf('automations?.stop()')).toBeGreaterThan(
      source.indexOf("app.on('will-quit'")
    )
  })
})
