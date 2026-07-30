import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/terminal-runtime-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityFactory = 'const terminalRuntime = createTerminalRuntimeStartupCapability()'
const capabilityInstall = 'installTerminalRuntimeStartupCapability(terminalRuntime)'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('terminal-runtime startup boundary', () => {
  it('removes all four eager index targets behind one aggregate capability', () => {
    expect(findImport('./ipc/pty')).toBeUndefined()
    expect(findImport('./daemon/daemon-init')).toBeUndefined()
    expect(findImport('./providers/local-pty-provider')).toBeUndefined()
    expect(findImport('./startup/first-window-startup-services')).toBeUndefined()
    expect(findImport('./startup/terminal-runtime-startup-owner')).toBeDefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
    expect(source.split(capabilityInstall)).toHaveLength(2)
  })

  it('installs after browser and window capabilities before terminal teardown registration', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const browserFactoryIndex = source.indexOf(
      'const browserKernel = createBrowserKernelStartupCapability()',
      readyIndex
    )
    const windowInstallIndex = source.indexOf(
      'installMainWindowStartupCapability(createMainWindowStartupCapability())',
      browserFactoryIndex
    )
    const terminalImportIndex = source.indexOf(capabilityImport, windowInstallIndex)
    const terminalFactoryIndex = source.indexOf(capabilityFactory, terminalImportIndex)
    const terminalInstallIndex = source.indexOf(capabilityInstall, terminalFactoryIndex)
    const paneTeardownIndex = source.indexOf(
      'terminalRuntime.registerPaneKeyTeardownListener(stopSyntheticTitleSpinner)',
      terminalInstallIndex
    )
    const browserManagerIndex = source.indexOf(
      'const browserManager = browserKernel.browserManager',
      paneTeardownIndex
    )

    expect(terminalImportIndex).toBeGreaterThan(windowInstallIndex)
    expect(terminalFactoryIndex).toBeGreaterThan(terminalImportIndex)
    expect(terminalInstallIndex).toBeGreaterThan(terminalFactoryIndex)
    expect(paneTeardownIndex).toBeGreaterThan(terminalInstallIndex)
    expect(browserManagerIndex).toBeGreaterThan(paneTeardownIndex)
    expect(source.split('registerPaneKeyTeardownListener(')).toHaveLength(2)
  })

  it('preserves daemon gates, error callbacks, and all three startup promise identities', () => {
    const startIndex = source.indexOf('function startTerminalRuntimeStartupServices():')
    const startEnd = source.indexOf('\nfunction prepareCodexRuntimeHomeForLaunch', startIndex)
    const startBlock = source.slice(startIndex, startEnd)

    expect(startBlock).toContain(
      'const { initDaemonPtyProvider, startFirstWindowStartupServices } ='
    )
    expect(startBlock).toContain(
      "macosLoginSessionWatch: process.platform === 'darwin' && !isServeMode"
    )
    expect(startBlock).toContain("track('daemon_start_failed', classifyError(error))")
    expect(startBlock).toContain(
      'firstWindowStartupServicesReady = startupServices.firstWindowReady'
    )
    expect(startBlock).toContain('localPtyStartupReady = startupServices.localPtyReady')
    expect(startBlock).toContain(
      'localPtyProviderStartupReady = startupServices.localPtyProviderReady'
    )
  })

  it('keeps live provider identity, serve fallback, and headless registration ordering', () => {
    const runtimeIndex = source.indexOf('createOrcaRuntimeServiceStartupCapability(store, stats, {')
    const startupIndex = source.indexOf('startTerminalRuntimeStartupServices()', runtimeIndex)
    const serveIndex = source.indexOf('if (serveOptions) {', startupIndex)
    const localBarrierIndex = source.indexOf('await localPtyStartupReady', serveIndex)
    const headlessIndex = source.indexOf('terminalRuntime.registerHeadlessPtyRuntime(', serveIndex)
    const graphIndex = source.indexOf('runtime.syncWindowGraph(', headlessIndex)
    const rpcIndex = source.indexOf('await runtimeRpc.start()', graphIndex)
    const activationIndex = source.indexOf('settleServeDesktopActivation()', rpcIndex)

    expect(source).toContain('getLocalProvider: () => terminalRuntime.getLocalPtyProvider()')
    expect(source).toContain(
      'getSshProvider: (connectionId) => terminalRuntime.getSshPtyProvider(connectionId)'
    )
    expect(source).toContain('onPtyStopped: terminalRuntime.clearProviderPtyState')
    expect(source).toContain('getLocalPtyProvider() instanceof LocalPtyProvider')
    expect(startupIndex).toBeGreaterThan(runtimeIndex)
    expect(localBarrierIndex).toBeGreaterThan(serveIndex)
    expect(headlessIndex).toBeGreaterThan(localBarrierIndex)
    expect(graphIndex).toBeGreaterThan(headlessIndex)
    expect(rpcIndex).toBeGreaterThan(graphIndex)
    expect(activationIndex).toBeGreaterThan(rpcIndex)
  })

  it('preserves PTY kill and daemon teardown choice inside the committed quit sequence', () => {
    const quitIndex = source.indexOf("app.on('will-quit', (e) => {")
    const quitBlock = source.slice(quitIndex)
    const statsIndex = quitBlock.indexOf('stats?.flush()')
    const killIndex = quitBlock.indexOf('terminalRuntime?.killAllPty()')
    const storeIndex = quitBlock.indexOf('store?.flush()')
    const daemonIndex = quitBlock.indexOf('const daemonTeardown = terminalRuntime')
    const devShutdownIndex = quitBlock.indexOf('terminalRuntime.shutdownDaemon()', daemonIndex)
    const normalDisconnectIndex = quitBlock.indexOf(
      'terminalRuntime.disconnectDaemon()',
      devShutdownIndex
    )

    expect(quitBlock).toContain(
      'const terminalRuntime = getTerminalRuntimeStartupCapabilityIfInstalled()'
    )
    expect(killIndex).toBeGreaterThan(statsIndex)
    expect(storeIndex).toBeGreaterThan(killIndex)
    expect(daemonIndex).toBeGreaterThan(storeIndex)
    expect(devShutdownIndex).toBeGreaterThan(daemonIndex)
    expect(normalDisconnectIndex).toBeGreaterThan(devShutdownIndex)
  })
})
