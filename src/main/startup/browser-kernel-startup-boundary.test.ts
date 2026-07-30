import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const source = readFileSync(join(projectRoot, 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const createWindowSource = readFileSync(
  join(projectRoot, 'src/main/window/createMainWindow.ts'),
  'utf8'
)
const attachWindowSource = readFileSync(
  join(projectRoot, 'src/main/window/attach-main-window-services.ts'),
  'utf8'
)
const capabilityModule = './startup/browser-kernel-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityFactory = 'const browserKernel = createBrowserKernelStartupCapability()'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('browser kernel startup boundary', () => {
  it('keeps index type-only and uses one dynamic aggregate capability', () => {
    expect(findImport('./browser/browser-manager')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./browser/browser-session-startup')).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('removes browser kernel values from both eager window modules', () => {
    for (const windowSource of [createWindowSource, attachWindowSource]) {
      expect(windowSource).not.toContain("from '../browser/browser-manager'")
      expect(windowSource).not.toContain("from '../browser/browser-session-registry'")
      expect(windowSource).toContain("from '../browser/browser-kernel-window-dependencies'")
    }
    expect(createWindowSource).toContain('const { browserManager, isAllowedSessionPartition } =')
    expect(attachWindowSource).toContain(
      'const { browserManager } = getBrowserKernelWindowDependencies()'
    )
  })

  it('loads at the earliest ready point before certificate registration and browser use', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const milestoneIndex = source.indexOf("logStartupMilestone('app-ready')", readyIndex)
    const importIndex = source.indexOf(capabilityImport, milestoneIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const assignmentIndex = source.indexOf(
      'browserManagerForShutdown = browserManager',
      factoryIndex
    )
    const watchdogIndex = source.indexOf('installMainThreadHangWatchdog(', assignmentIndex)
    const certificateIndex = source.indexOf("app.on(\n    'certificate-error'", watchdogIndex)

    expect(milestoneIndex).toBeGreaterThan(readyIndex)
    expect(importIndex).toBeGreaterThan(milestoneIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(assignmentIndex).toBeGreaterThan(factoryIndex)
    expect(watchdogIndex).toBeGreaterThan(assignmentIndex)
    expect(certificateIndex).toBeGreaterThan(watchdogIndex)
  })

  it('preserves every certificate callback argument on the returned controller', () => {
    const certificateIndex = source.indexOf("app.on(\n    'certificate-error'")
    const certificateEnd = source.indexOf('electronApp.setAppUserModelId', certificateIndex)
    const certificateBlock = source.slice(certificateIndex, certificateEnd)

    expect(certificateBlock).toContain(
      'browserKernel.browserCertificateTrustController.handleCertificateError({'
    )
    for (const argument of [
      'event,',
      'webContents,',
      'url,',
      'error,',
      'certificate,',
      'callback,',
      'isMainFrame'
    ]) {
      expect(certificateBlock).toContain(argument)
    }
  })

  it('preserves session initialization inputs and downstream manager identity/order', () => {
    const proxyIndex = source.indexOf('await applyElectronProxySettings(store.getSettings())')
    const sessionIndex = source.indexOf(
      'browserKernel.initializeBrowserSessionsForApp({',
      proxyIndex
    )
    const systemResumeIndex = source.indexOf(
      'unsubscribeSystemResumeBroadcast = registerSystemResumeBroadcast()',
      sessionIndex
    )
    const settingsIndex = source.indexOf('browserManager.setSettingsResolver(', systemResumeIndex)
    const guestListenerIndex = source.indexOf(
      'browserManager.setBrowserGuestStateChangedListener(',
      settingsIndex
    )
    const agentBrowserIndex = source.indexOf(
      'attachAgentBrowserStartupCapability(runtimeService, browserManager)',
      guestListenerIndex
    )
    const offscreenIndex = source.indexOf(
      'attachOffscreenBrowserStartupCapability(runtime, browserManager)',
      agentBrowserIndex
    )

    expect(sessionIndex).toBeGreaterThan(proxyIndex)
    const sessionBlock = source.slice(sessionIndex, systemResumeIndex)
    expect(sessionBlock).toContain('orcaProfileId: activeOrcaProfile.profile.id')
    expect(sessionBlock).toContain('profileDirectory: activeOrcaProfile.profileDirectory')
    expect(settingsIndex).toBeGreaterThan(systemResumeIndex)
    expect(guestListenerIndex).toBeGreaterThan(settingsIndex)
    expect(agentBrowserIndex).toBeGreaterThan(guestListenerIndex)
    expect(offscreenIndex).toBeGreaterThan(agentBrowserIndex)
  })

  it('keeps headless and desktop readiness plus shutdown clearing after kernel setup', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const serveIndex = source.indexOf('if (serveOptions) {', factoryIndex)
    const headlessGraphIndex = source.indexOf(
      'runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID',
      serveIndex
    )
    const headlessRpcIndex = source.indexOf('await runtimeRpc.start()', headlessGraphIndex)
    const desktopWindowIndex = source.indexOf('Promise.resolve(openMainWindow())', headlessRpcIndex)
    const shutdownIndex = source.indexOf("app.on('will-quit'")
    const clearListenerIndex = source.indexOf(
      'browserManagerForShutdown?.setBrowserGuestStateChangedListener(null)',
      shutdownIndex
    )

    expect(serveIndex).toBeGreaterThan(factoryIndex)
    expect(headlessGraphIndex).toBeGreaterThan(serveIndex)
    expect(headlessRpcIndex).toBeGreaterThan(headlessGraphIndex)
    expect(desktopWindowIndex).toBeGreaterThan(headlessRpcIndex)
    expect(clearListenerIndex).toBeGreaterThan(shutdownIndex)
  })
})
