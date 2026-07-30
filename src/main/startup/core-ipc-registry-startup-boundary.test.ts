import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const registrySource = readFileSync(
  join(process.cwd(), 'src/main/ipc/register-core-handlers.ts'),
  'utf8'
)
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/core-ipc-registry-startup-capability'
const capabilityImport = `import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

function functionSource(name: string): string {
  const declaration = sourceFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((candidate) => candidate.name?.text === name)
  expect(declaration).toBeDefined()
  return source.slice(declaration!.getStart(sourceFile), declaration!.getEnd())
}

describe('core IPC registry startup boundary', () => {
  it('keeps the aggregate registry out of the eager main graph behind one import', () => {
    expect(findImport('./ipc/register-core-handlers')).toBeUndefined()
    expect(findImport(capabilityModule)?.importClause?.isTypeOnly).toBe(true)
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split('getCoreIpcRegistryStartupCapability()')).toHaveLength(2)
    expect(source).toContain('let coreIpcRegistry: CoreIpcRegistry | null = null')
    expect(source).toContain(
      'let coreIpcRegistryLoadPromise: Promise<CoreIpcRegistry> | null = null'
    )
  })

  it('keeps ordinary headless serve import-free and loads before desktop parallel startup', () => {
    const serveStart = source.indexOf('if (serveOptions) {')
    const serveReady = source.indexOf('await printServeReady(serveOptions)', serveStart)
    const serveReturn = source.indexOf('return', serveReady)
    const desktopLoad = source.indexOf('await loadCoreIpcRegistryForDesktop()', serveReturn)
    const parallelStart = source.indexOf('const [win, runtimeRpcStartResult]', desktopLoad)
    const windowStart = source.indexOf('Promise.resolve(openMainWindow())', parallelStart)
    const rpcStart = source.indexOf('runtimeRpc.start().then(', windowStart)
    const serveBlock = source.slice(serveStart, serveReturn)

    expect(serveStart).toBeGreaterThanOrEqual(0)
    expect(serveReady).toBeGreaterThan(serveStart)
    expect(serveReturn).toBeGreaterThan(serveReady)
    expect(serveBlock).not.toContain(capabilityModule)
    expect(serveBlock).not.toContain('loadCoreIpcRegistryForDesktop')
    expect(desktopLoad).toBeGreaterThan(serveReturn)
    expect(parallelStart).toBeGreaterThan(desktopLoad)
    expect(windowStart).toBeGreaterThan(parallelStart)
    expect(rpcStart).toBeGreaterThan(windowStart)
  })

  it('preserves synchronous registration at the original window construction point', () => {
    const declaration = sourceFile.statements
      .filter(ts.isFunctionDeclaration)
      .find((candidate) => candidate.name?.text === 'openMainWindow')
    expect(declaration).toBeDefined()
    expect(
      Boolean(
        declaration!.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      )
    ).toBe(false)

    const openWindow = functionSource('openMainWindow')
    const guardIndex = openWindow.indexOf('const registerCoreHandlers = coreIpcRegistry')
    const createIndex = openWindow.indexOf('const window = createMainWindow(')
    const didFinishLoadIndex = openWindow.indexOf(
      "window.webContents.on('did-finish-load', onFirstWindowLoad)"
    )
    const registryIndex = openWindow.indexOf('registerCoreHandlers(')
    const automationIndex = openWindow.indexOf(
      'automations.setWebContents(window.webContents)',
      registryIndex
    )
    const attachedServicesIndex = openWindow.indexOf('attachMainWindowServices(', automationIndex)
    const rateLimitIndex = openWindow.indexOf('rateLimits.attach(window)', attachedServicesIndex)
    const rendererLoadIndex = openWindow.indexOf('loadMainWindow(window)', rateLimitIndex)

    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(createIndex).toBeGreaterThan(guardIndex)
    expect(didFinishLoadIndex).toBeGreaterThan(createIndex)
    expect(registryIndex).toBeGreaterThan(didFinishLoadIndex)
    expect(automationIndex).toBeGreaterThan(registryIndex)
    expect(attachedServicesIndex).toBeGreaterThan(automationIndex)
    expect(rateLimitIndex).toBeGreaterThan(attachedServicesIndex)
    expect(rendererLoadIndex).toBeGreaterThan(rateLimitIndex)
  })

  it('reuses the loaded slot for activation and later window recreation', () => {
    const guardedAction = functionSource('runDesktopActionWhenCoreIpcReady')
    const trayReopen = functionSource('showMainWindowFromTray')
    const settingsOpen = functionSource('openSettingsFromSystemMenu')
    const openWindow = functionSource('openMainWindow')

    expect(source).toContain(
      'activateWindow: () => runDesktopActionWhenCoreIpcReady(focusExistingWindow)'
    )
    expect(guardedAction).toContain('if (coreIpcRegistry) {')
    expect(guardedAction).toContain('action()')
    expect(guardedAction).toContain('loadCoreIpcRegistryForDesktop()')
    expect(trayReopen).toContain('runDesktopActionWhenCoreIpcReady(openMainWindow)')
    expect(settingsOpen).toContain('runDesktopActionWhenCoreIpcReady(openSettingsFromSystemMenu)')
    expect(openWindow).toContain(
      "throw new Error('Core IPC registry must be loaded before opening the main window')"
    )
    expect(openWindow.split('registerCoreHandlers(')).toHaveLength(2)
    expect(registrySource).toContain('let registered = false')
    expect(registrySource).toContain('if (registered) {')
    expect(registrySource).toContain('registered = true')
  })

  it('passes every original service and lifecycle object by identity', () => {
    const openWindow = functionSource('openMainWindow')
    const registerIndex = openWindow.indexOf('registerCoreHandlers(')
    const automationIndex = openWindow.indexOf(
      'automations.setWebContents(window.webContents)',
      registerIndex
    )
    const registration = openWindow.slice(registerIndex, automationIndex)
    const identities = [
      'store,',
      'runtime,',
      'stats,',
      'claudeUsage,',
      'codexUsage,',
      'openCodeUsage,',
      'codexAccounts,',
      'claudeAccounts,',
      'rateLimits,',
      'rendererWebContentsId,',
      'automations,',
      'agentAwakeService ?? undefined,',
      'crashReports ?? undefined,',
      'keybindings,',
      'pluginService ?? undefined,',
      'pluginMarketplaceService && pluginMarketplaceInstaller'
    ]
    let previousIndex = -1

    for (const identity of identities) {
      const identityIndex = registration.indexOf(identity, previousIndex + 1)
      expect(identityIndex).toBeGreaterThan(previousIndex)
      previousIndex = identityIndex
    }
    expect(registration).toContain('prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch')
    expect(registration).toContain(
      'prepareForClaudeLaunch: (target) => claudeRuntimeAuth!.prepareForClaudeLaunch(target)'
    )
    expect(registration).toContain(
      'await preserveAgentAuthBeforeRestart({ codexRuntimeHome, claudeRuntimeAuth, store })'
    )
    expect(registration).toContain(
      'onOrcaProfileAuthMutation: () => desktopRelayService?.authMutated()'
    )
    expect(registration).toContain(
      'onBeforeOrcaProfileSignOut: () => desktopRelayService?.fenceAndCloseNow()'
    )
  })
})
