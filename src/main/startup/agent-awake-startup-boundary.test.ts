import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/agent-awake-startup-capability')"
const capabilityFactory = 'agentAwakeService = await createAgentAwakeStartupCapability()'

describe('agent awake startup boundary', () => {
  it('keeps the service implementation out of the eager main graph', () => {
    const serviceImport = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .find(
        (declaration) =>
          (declaration.moduleSpecifier as ts.StringLiteral).text === './agent-awake-service'
      )

    expect(serviceImport?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new AgentAwakeService(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('initializes the service before subscriptions and observable readiness', () => {
    const importIndex = source.indexOf(capabilityImport)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const settingsIndex = source.indexOf(
      'agentAwakeService.setEnabled(store.getSettings().keepComputerAwakeWhileAgentsRun)',
      factoryIndex
    )
    const subscriptionIndex = source.indexOf(
      'agentHookServer.subscribeStatusChanges',
      settingsIndex
    )
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(settingsIndex).toBeGreaterThan(factoryIndex)
    expect(subscriptionIndex).toBeGreaterThan(settingsIndex)
    expect(initializedIndex).toBeGreaterThan(subscriptionIndex)
  })
})
