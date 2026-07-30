import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const source = readFileSync(join(projectRoot, 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/main-window-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityInstall = 'installMainWindowStartupCapability(createMainWindowStartupCapability())'

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      return listProductionTypeScriptFiles(entryPath)
    }
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
      ? [entryPath]
      : []
  })
}

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('main-window startup boundary', () => {
  it('removes both eager target modules behind one dynamic aggregate capability', () => {
    expect(findImport('./window/createMainWindow')).toBeUndefined()
    expect(findImport('./window/attach-main-window-services')).toBeUndefined()
    expect(findImport('./startup/main-window-startup-owner')).toBeDefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityInstall)).toHaveLength(2)
  })

  it('keeps production value importers limited to deferred capability graphs', () => {
    const productionSources = listProductionTypeScriptFiles(join(projectRoot, 'src/main')).map(
      (filePath) => ({ filePath, source: readFileSync(filePath, 'utf8') })
    )
    const createWindowImporters = productionSources
      .filter(({ source: fileSource }) => fileSource.includes("from '../window/createMainWindow'"))
      .map(({ filePath }) => filePath)
    const attachWindowImporters = productionSources
      .filter(({ source: fileSource }) =>
        fileSource.includes("from '../window/attach-main-window-services'")
      )
      .map(({ filePath }) => filePath)

    expect(createWindowImporters).toEqual([
      join(projectRoot, 'src/main/startup/main-window-startup-capability.ts')
    ])
    expect(attachWindowImporters).toEqual([
      join(projectRoot, 'src/main/ipc/register-core-handlers.ts'),
      join(projectRoot, 'src/main/startup/main-window-startup-capability.ts')
    ])
  })

  it('loads immediately after browser-kernel initialization at the earliest ready point', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const browserImportIndex = source.indexOf(
      "await import('./startup/browser-kernel-startup-capability')",
      readyIndex
    )
    const browserFactoryIndex = source.indexOf(
      'const browserKernel = createBrowserKernelStartupCapability()',
      browserImportIndex
    )
    const windowImportIndex = source.indexOf(capabilityImport, browserFactoryIndex)
    const installIndex = source.indexOf(capabilityInstall, windowImportIndex)
    const browserManagerIndex = source.indexOf(
      'const browserManager = browserKernel.browserManager',
      installIndex
    )
    const watchdogIndex = source.indexOf('installMainThreadHangWatchdog(', browserManagerIndex)

    expect(browserImportIndex).toBeGreaterThan(readyIndex)
    expect(browserFactoryIndex).toBeGreaterThan(browserImportIndex)
    expect(windowImportIndex).toBeGreaterThan(browserFactoryIndex)
    expect(installIndex).toBeGreaterThan(windowImportIndex)
    expect(browserManagerIndex).toBeGreaterThan(installIndex)
    expect(watchdogIndex).toBeGreaterThan(browserManagerIndex)
  })

  it('keeps predeclared consumers fail-closed and preserves synchronous create/attach/load order', () => {
    const openStart = source.indexOf('function openMainWindow(): BrowserWindow {')
    const openEnd = source.indexOf('\nfunction sendOpenFeatureTour', openStart)
    const openWindow = source.slice(openStart, openEnd)
    const ownerIndex = openWindow.indexOf('getMainWindowStartupCapability()')
    const createIndex = openWindow.indexOf('const window = createMainWindow(')
    const coreIpcIndex = openWindow.indexOf('registerCoreHandlers(')
    const automationIndex = openWindow.indexOf('automations.start()', coreIpcIndex)
    const attachIndex = openWindow.indexOf('attachMainWindowServices(', automationIndex)
    const loadIndex = openWindow.indexOf('loadMainWindow(window)', attachIndex)

    expect(ownerIndex).toBeGreaterThanOrEqual(0)
    expect(createIndex).toBeGreaterThan(ownerIndex)
    expect(coreIpcIndex).toBeGreaterThan(createIndex)
    expect(automationIndex).toBeGreaterThan(coreIpcIndex)
    expect(attachIndex).toBeGreaterThan(automationIndex)
    expect(loadIndex).toBeGreaterThan(attachIndex)
    expect(openWindow).toContain('deferLoad: true')
  })

  it('preserves updater identity and manual crash-recovery reload through the owner', () => {
    const updateStart = source.indexOf('function runUserInitiatedUpdateCheck(')
    const updateEnd = source.indexOf('\nfunction getSystemTrayOptions', updateStart)
    const updateBlock = source.slice(updateStart, updateEnd)
    const recoveryStart = source.indexOf('async function presentRendererRecoveryPrompt(')
    const recoveryEnd = source.indexOf('\nfunction getGpuFallbackEnvironment', recoveryStart)
    const recoveryBlock = source.slice(recoveryStart, recoveryEnd)

    expect(updateBlock).toContain(
      'const { ensureAutoUpdaterConfigured } = getMainWindowStartupCapability()'
    )
    expect(updateBlock.indexOf('ensureAutoUpdaterConfigured()')).toBeLessThan(
      updateBlock.indexOf('checkForUpdatesFromMenu(options)')
    )
    expect(recoveryBlock).toContain('const { loadMainWindow } = getMainWindowStartupCapability()')
    expect(recoveryBlock).toContain('loadMainWindow(mainWindow)')
  })

  it('installs before activation, serve promotion, core IPC, and desktop parallel startup', () => {
    const installIndex = source.indexOf(capabilityInstall)
    const activateIndex = source.indexOf("app.on('activate', handleMacAppActivation)", installIndex)
    const serveIndex = source.indexOf('if (serveOptions) {', activateIndex)
    const settleServeIndex = source.indexOf('settleServeDesktopActivation()', serveIndex)
    const coreIpcIndex = source.indexOf('await loadCoreIpcRegistryForDesktop()', settleServeIndex)
    const parallelIndex = source.indexOf('const [win, runtimeRpcStartResult] = await Promise.all([')
    const windowIndex = source.indexOf('Promise.resolve(openMainWindow())', parallelIndex)
    const rpcIndex = source.indexOf('runtimeRpc.start().then(', windowIndex)

    expect(activateIndex).toBeGreaterThan(installIndex)
    expect(serveIndex).toBeGreaterThan(activateIndex)
    expect(settleServeIndex).toBeGreaterThan(serveIndex)
    expect(coreIpcIndex).toBeGreaterThan(settleServeIndex)
    expect(parallelIndex).toBeGreaterThan(coreIpcIndex)
    expect(windowIndex).toBeGreaterThan(parallelIndex)
    expect(rpcIndex).toBeGreaterThan(windowIndex)
  })
})
