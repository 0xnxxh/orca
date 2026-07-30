import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/updater-runtime-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityFactory = 'const updaterRuntime = createUpdaterRuntimeStartupCapability()'
const capabilityInstall = 'installUpdaterRuntimeStartupCapability(updaterRuntime)'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('updater-runtime startup boundary', () => {
  it('removes eager updater graphs while retaining only the narrow quit-state seam', () => {
    expect(findImport('./updater')).toBeUndefined()
    expect(findImport('./runtime/remote-server-updater')).toBeUndefined()
    expect(findImport('./updater-quit-state')).toBeDefined()
    expect(findImport('./startup/updater-runtime-startup-owner')).toBeDefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
    expect(source.split(capabilityInstall)).toHaveLength(2)
  })

  it('loads after retained capabilities and configures the adapter before later startup', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const browserIndex = source.indexOf(
      'const browserKernel = createBrowserKernelStartupCapability()',
      readyIndex
    )
    const windowIndex = source.indexOf(
      'installMainWindowStartupCapability(createMainWindowStartupCapability())',
      browserIndex
    )
    const terminalIndex = source.indexOf(
      'installTerminalRuntimeStartupCapability(terminalRuntime)',
      windowIndex
    )
    const paneTeardownIndex = source.indexOf(
      'terminalRuntime.registerPaneKeyTeardownListener(stopSyntheticTitleSpinner)',
      terminalIndex
    )
    const updaterImportIndex = source.indexOf(capabilityImport, paneTeardownIndex)
    const updaterFactoryIndex = source.indexOf(capabilityFactory, updaterImportIndex)
    const updaterInstallIndex = source.indexOf(capabilityInstall, updaterFactoryIndex)
    const configureIndex = source.indexOf(
      'updaterRuntime.configureRemoteServerUpdater({',
      updaterInstallIndex
    )
    const browserManagerIndex = source.indexOf(
      'const browserManager = browserKernel.browserManager',
      configureIndex
    )
    const runtimeRpcIndex = source.indexOf(
      'createOrcaRuntimeRpcServerStartupCapability({',
      browserManagerIndex
    )

    expect(updaterImportIndex).toBeGreaterThan(paneTeardownIndex)
    expect(updaterFactoryIndex).toBeGreaterThan(updaterImportIndex)
    expect(updaterInstallIndex).toBeGreaterThan(updaterFactoryIndex)
    expect(configureIndex).toBeGreaterThan(updaterInstallIndex)
    expect(browserManagerIndex).toBeGreaterThan(configureIndex)
    expect(runtimeRpcIndex).toBeGreaterThan(browserManagerIndex)
  })

  it('configures the adapter with the exact shared updater identities', () => {
    const configureIndex = source.indexOf('updaterRuntime.configureRemoteServerUpdater({')
    const configureEnd = source.indexOf('\n  })', configureIndex)
    const configuration = source.slice(configureIndex, configureEnd)

    expect(configuration).toContain('getSnapshot: updaterRuntime.getRemoteServerUpdaterSnapshot')
    expect(configuration).toContain('check: updaterRuntime.checkForRemoteServerUpdate')
    expect(configuration).toContain('download: updaterRuntime.downloadRemoteServerUpdate')
    expect(configuration).toContain('install: updaterRuntime.installRemoteServerUpdate')
  })

  it('sets the process app version before loading or configuring updater runtime', () => {
    const appVersionIndex = source.indexOf('process.env.ORCA_APP_VERSION = app.getVersion()')
    const capabilityIndex = source.indexOf(capabilityImport)
    const configureIndex = source.indexOf('updaterRuntime.configureRemoteServerUpdater({')

    expect(appVersionIndex).toBeGreaterThanOrEqual(0)
    expect(capabilityIndex).toBeGreaterThan(appVersionIndex)
    expect(configureIndex).toBeGreaterThan(capabilityIndex)
  })

  it('preserves synchronous early quit-state checks through the minimal state seam', () => {
    const activationStart = source.indexOf('function runDesktopActionWhenCoreIpcReady(')
    const activationEnd = source.indexOf('\nconst desktopActivationGate', activationStart)
    const activationBlock = source.slice(activationStart, activationEnd)
    const teardownStart = source.indexOf('function getExpectedTeardownScope(')
    const teardownEnd = source.indexOf('\nfunction markRecoveryReloadInFlight', teardownStart)
    const teardownBlock = source.slice(teardownStart, teardownEnd)
    const beforeQuitIndex = source.indexOf("app.on('before-quit', () => {")
    const willQuitIndex = source.indexOf("app.on('will-quit', (e) => {")

    expect(activationBlock).toContain('if (isQuittingForUpdate())')
    expect(activationBlock).toContain('if (!isQuittingForUpdate())')
    expect(teardownBlock).toContain('if (isQuitting || isQuittingForUpdate())')
    expect(source.indexOf('isQuittingForUpdate()', beforeQuitIndex)).toBeLessThan(willQuitIndex)
    expect(source.indexOf('isQuittingForUpdate()', willQuitIndex)).toBeGreaterThan(willQuitIndex)
  })

  it('preserves menu ordering and main-window update-install mode ownership', () => {
    const checkStart = source.indexOf('function runUserInitiatedUpdateCheck(')
    const checkEnd = source.indexOf('\nfunction getSystemTrayOptions', checkStart)
    const checkBlock = source.slice(checkStart, checkEnd)
    const ensureIndex = checkBlock.indexOf('ensureAutoUpdaterConfigured()')
    const checkIndex = checkBlock.indexOf(
      'getUpdaterRuntimeStartupCapability().checkForUpdatesFromMenu(options)'
    )
    const attachIndex = source.indexOf('attachMainWindowServices(')
    const modeIndex = source.indexOf(
      'getUpdaterRuntimeStartupCapability().resolveUpdateInstallMode(isServeMode)',
      attachIndex
    )

    expect(ensureIndex).toBeGreaterThanOrEqual(0)
    expect(checkIndex).toBeGreaterThan(ensureIndex)
    expect(modeIndex).toBeGreaterThan(attachIndex)
  })
})
