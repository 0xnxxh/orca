import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/plugin-system-startup-capability')"
const capabilityFactory = 'const pluginSystem = await createPluginSystemStartupCapability('

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('plugin system startup boundary', () => {
  it('keeps all five implementations and startup-only resolvers out of the eager main graph', () => {
    const serviceModules = [
      './plugins/plugin-service',
      './plugins/plugin-kill-list-service',
      './plugins/plugin-marketplace-service',
      './plugins/plugin-marketplace-installer',
      './plugins/plugin-bundled-bootstrap-coordinator'
    ]

    for (const moduleSpecifier of serviceModules) {
      expect(findImport(moduleSpecifier)?.importClause?.isTypeOnly).toBe(true)
    }
    for (const moduleSpecifier of [
      './plugins/plugin-discovery',
      './plugins/plugin-bundled-bootstrap',
      './plugins/plugin-host-process',
      '../shared/plugins/plugin-consent-state'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }
    expect(source).not.toMatch(
      /new (PluginService|PluginKillListService|PluginMarketplaceService|PluginMarketplaceInstaller|PluginBundledBootstrapCoordinator)\(/
    )
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('assigns every returned singleton before plugin wiring and initialization', () => {
    const importIndex = source.indexOf(capabilityImport)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const assignments = [
      'pluginKillListService = pluginSystem.killList',
      'pluginMarketplaceService = pluginSystem.marketplace',
      'pluginMarketplaceInstaller = pluginSystem.marketplaceInstaller',
      'pluginService = pluginSystem.pluginService',
      'const bundledPluginBootstrap: PluginBundledBootstrapCoordinator = pluginSystem.bundledBootstrap'
    ]
    let previousIndex = factoryIndex
    for (const assignment of assignments) {
      const assignmentIndex = source.indexOf(assignment, previousIndex)
      expect(assignmentIndex).toBeGreaterThan(previousIndex)
      previousIndex = assignmentIndex
    }

    const killListListenerIndex = source.indexOf('pluginKillListService.onChanged(', previousIndex)
    const settingsListenerIndex = source.indexOf('store.onSettingsChanged(', killListListenerIndex)
    const rpcIndex = source.indexOf(
      'setPluginServiceForRpc(pluginService, {',
      settingsListenerIndex
    )
    const initializeIndex = source.indexOf('.initialize()', rpcIndex)
    const initializedMilestoneIndex = source.indexOf(
      "logStartupMilestone('services-initialized')",
      initializeIndex
    )

    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(killListListenerIndex).toBeGreaterThan(previousIndex)
    expect(settingsListenerIndex).toBeGreaterThan(killListListenerIndex)
    expect(rpcIndex).toBeGreaterThan(settingsListenerIndex)
    expect(initializeIndex).toBeGreaterThan(rpcIndex)
    expect(initializedMilestoneIndex).toBeGreaterThan(initializeIndex)
  })

  it('keeps feature gates, bootstrap timing, broadcasts, and event taps in index', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const settingsGateIndex = source.indexOf(
      'if (store?.getSettings().pluginSystemEnabled !== true)',
      factoryIndex
    )
    const packagedRefreshIndex = source.indexOf(
      'if (app.isPackaged && store?.getSettings().pluginSystemEnabled === true)',
      settingsGateIndex
    )
    const changedIndex = source.indexOf(
      'pluginService.onChanged((event) => {',
      packagedRefreshIndex
    )
    const languagePackIndex = source.indexOf('setMainPluginLanguagePacks(', changedIndex)
    const rendererBroadcastIndex = source.indexOf(
      "window.webContents.send('plugins:changed', event)",
      languagePackIndex
    )
    const bootstrapIndex = source.indexOf('requestBundledPluginBootstrap()', rendererBroadcastIndex)
    const marketplaceIndex = source.indexOf('requestOfficialMarketplaceSeed()', bootstrapIndex)
    const agentEventIndex = source.indexOf(
      "pluginService?.emitEvent('agent.status.changed'",
      marketplaceIndex
    )
    const worktreeEventIndex = source.indexOf('emitPluginWorktreeLifecycle(event)', agentEventIndex)

    expect(settingsGateIndex).toBeGreaterThan(factoryIndex)
    expect(packagedRefreshIndex).toBeGreaterThan(settingsGateIndex)
    expect(changedIndex).toBeGreaterThan(packagedRefreshIndex)
    expect(languagePackIndex).toBeGreaterThan(changedIndex)
    expect(rendererBroadcastIndex).toBeGreaterThan(languagePackIndex)
    expect(bootstrapIndex).toBeGreaterThan(rendererBroadcastIndex)
    expect(marketplaceIndex).toBeGreaterThan(bootstrapIndex)
    expect(agentEventIndex).toBeGreaterThan(marketplaceIndex)
    expect(worktreeEventIndex).toBeGreaterThan(agentEventIndex)
  })

  it('keeps core IPC identity, window readiness, RPC startup, and teardown unchanged', () => {
    const coreHandlersIndex = source.indexOf('registerCoreHandlers(')
    const corePluginIndex = source.indexOf('pluginService ?? undefined,', coreHandlersIndex)
    const coreMarketplaceIndex = source.indexOf(
      'pluginMarketplaceService && pluginMarketplaceInstaller',
      corePluginIndex
    )
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")
    const desktopWindowIndex = source.indexOf('Promise.resolve(openMainWindow())', initializedIndex)
    const desktopRpcIndex = source.indexOf('runtimeRpc.start().then(', desktopWindowIndex)
    const clearRpcIndex = source.indexOf('setPluginServiceForRpc(null)')
    const clearKillListIndex = source.indexOf('pluginKillListService = null', clearRpcIndex)
    const clearMarketplaceIndex = source.indexOf(
      'pluginMarketplaceService = null',
      clearKillListIndex
    )
    const clearInstallerIndex = source.indexOf(
      'pluginMarketplaceInstaller = null',
      clearMarketplaceIndex
    )
    const disposeIndex = source.indexOf(
      'const pluginHostShutdown = pluginService?.dispose() ?? Promise.resolve()',
      clearInstallerIndex
    )
    const clearPluginIndex = source.indexOf('pluginService = null', disposeIndex)

    expect(corePluginIndex).toBeGreaterThan(coreHandlersIndex)
    expect(coreMarketplaceIndex).toBeGreaterThan(corePluginIndex)
    expect(desktopWindowIndex).toBeGreaterThan(initializedIndex)
    expect(desktopRpcIndex).toBeGreaterThan(desktopWindowIndex)
    expect(clearKillListIndex).toBeGreaterThan(clearRpcIndex)
    expect(clearMarketplaceIndex).toBeGreaterThan(clearKillListIndex)
    expect(clearInstallerIndex).toBeGreaterThan(clearMarketplaceIndex)
    expect(disposeIndex).toBeGreaterThan(clearInstallerIndex)
    expect(clearPluginIndex).toBeGreaterThan(disposeIndex)
    expect(source).toContain("{ name: 'plugin-hosts', promise: pluginHostShutdown }")
  })
})
