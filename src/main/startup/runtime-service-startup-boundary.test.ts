import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const runtimeModule = './runtime/orca-runtime'
const capabilityModule = './startup/runtime-service-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityFactory =
  'const runtimeService = createOrcaRuntimeServiceStartupCapability(store, stats, {'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('runtime service startup boundary', () => {
  it('keeps the implementation out of the eager main graph behind one factory', () => {
    expect(findImport(runtimeModule)?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new OrcaRuntimeService(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('constructs at the former point and assigns the same singleton immediately', () => {
    const accountResolverIndex = source.indexOf('rateLimits.setInactiveCodexAccountsResolver(')
    const transportIndex = source.indexOf(
      'const orchestrationEnvironmentTransport: OrchestrationEnvironmentTransport = {',
      accountResolverIndex
    )
    const importIndex = source.indexOf(capabilityImport, transportIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const globalAssignmentIndex = source.indexOf('runtime = runtimeService', factoryIndex)
    const providerPublicationIndex = source.indexOf(
      'publishProviderSessionChanges(agentHooks.agentHookServer.getProviderSessionIdentities())',
      globalAssignmentIndex
    )
    const browserListenerIndex = source.indexOf(
      'browserManager.setBrowserGuestStateChangedListener(',
      providerPublicationIndex
    )
    const automationImportIndex = source.indexOf(
      "await import('./startup/automation-service-startup-capability')",
      browserListenerIndex
    )

    expect(transportIndex).toBeGreaterThan(accountResolverIndex)
    expect(importIndex).toBeGreaterThan(transportIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(globalAssignmentIndex).toBeGreaterThan(factoryIndex)
    expect(providerPublicationIndex).toBeGreaterThan(globalAssignmentIndex)
    expect(browserListenerIndex).toBeGreaterThan(providerPublicationIndex)
    expect(automationImportIndex).toBeGreaterThan(browserListenerIndex)
  })

  it('passes every original constructor input and callback by identity', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const assignmentIndex = source.indexOf('runtime = runtimeService', factoryIndex)
    const construction = source.slice(factoryIndex, assignmentIndex)
    const identities = [
      'store, stats, {',
      'agentSessionClaimSigner: runtimeConnectivity.loadAgentSessionClaimSigner(',
      'getLocalProvider: () => terminalRuntime.getLocalPtyProvider()',
      'getSshProvider: (connectionId) => terminalRuntime.getSshPtyProvider(connectionId)',
      'onPtyStopped: terminalRuntime.clearProviderPtyState',
      'onTerminalAgentStatus: (event) => {',
      'onTerminalSideEffects: (batch: TerminalSideEffectBatch) => {',
      'getDesktopWindowStatus: getDesktopWindowStatus',
      'getAgentStatusSnapshot: () =>',
      'getAgentProviderSessionSnapshot: () => agentHooks.agentHookServer.getStatusSnapshot()',
      'getAgentProviderSessionRowsForPane: (paneKey) =>',
      'getAdditionalAiVaultCodexHomePaths: () =>',
      'prepareAiVaultSessionResume: (args) =>',
      'buildAgentHookPtyEnv: () =>',
      'orchestrationEnvironmentTransport'
    ]

    for (const identity of identities) {
      expect(construction).toContain(identity)
    }
  })

  it('preserves downstream wiring, startup branches, and teardown on one instance', () => {
    const assignmentIndex = source.indexOf('runtime = runtimeService')
    const orderedConsumers = [
      'runtimeService.setAutomationService(automations)',
      'runtimeService.setAccountServices({ claudeAccounts, codexAccounts, rateLimits })',
      'runtimeService.setCommitMessageAgentEnvironmentResolvers({',
      'runtimeService.onWorktreeLifecycle((event) => {',
      'attachAgentBrowserStartupCapability(runtimeService, browserManager)',
      'attachEmulatorStartupCapability(runtimeService)',
      'runtimeRpc = createOrcaRuntimeRpcServerStartupCapability({',
      'registerMobileHandlers(runtimeRpc, {'
    ]
    let previousIndex = assignmentIndex

    for (const consumer of orderedConsumers) {
      const consumerIndex = source.indexOf(consumer, previousIndex)
      expect(consumerIndex).toBeGreaterThan(previousIndex)
      previousIndex = consumerIndex
    }

    const serveIndex = source.indexOf('if (serveOptions) {', previousIndex)
    const headlessPtyIndex = source.indexOf('registerHeadlessPtyRuntime(', serveIndex)
    const desktopLoadIndex = source.indexOf(
      'await loadCoreIpcRegistryForDesktop()',
      headlessPtyIndex
    )
    const coreHandlersIndex = source.indexOf('registerCoreHandlers(')
    const quitIndex = source.indexOf("app.on('will-quit'")
    const browserTeardownIndex = source.indexOf(
      'runtime?.getAgentBrowserBridge()?.destroyAllSessions()',
      quitIndex
    )
    const offscreenTeardownIndex = source.indexOf(
      'runtime?.getOffscreenBrowserBackend()?.destroyAll?.()',
      browserTeardownIndex
    )
    const emulatorTeardownIndex = source.indexOf(
      'runtime?.getEmulatorBridge()?.destroyAllSessions()',
      offscreenTeardownIndex
    )

    expect(headlessPtyIndex).toBeGreaterThan(serveIndex)
    expect(desktopLoadIndex).toBeGreaterThan(headlessPtyIndex)
    expect(coreHandlersIndex).toBeGreaterThanOrEqual(0)
    expect(browserTeardownIndex).toBeGreaterThan(quitIndex)
    expect(offscreenTeardownIndex).toBeGreaterThan(browserTeardownIndex)
    expect(emulatorTeardownIndex).toBeGreaterThan(offscreenTeardownIndex)
  })
})
