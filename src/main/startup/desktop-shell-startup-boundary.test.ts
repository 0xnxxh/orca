import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/desktop-shell-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('desktop-shell startup boundary', () => {
  it('removes the eager desktop-shell graph while retaining the pre-ready focus leaf', () => {
    for (const moduleSpecifier of [
      './menu/register-app-menu',
      './tray/system-tray',
      './window/dashboard-popout-window',
      './window/macos-app-activation',
      './window/main-window-visibility',
      './dock/unread-badge',
      './ipc/notifications'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./window/focus-existing-window')).toBeDefined()
    expect(findImport('./startup/desktop-shell-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)?.importClause?.isTypeOnly).toBe(true)
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after retained app-ready capabilities and before desktop services', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const updaterIndex = source.indexOf(
      'installUpdaterRuntimeStartupCapability(updaterRuntime)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, updaterIndex)
    const factoryIndex = source.indexOf(
      'const desktopShell = createDesktopShellStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installDesktopShellStartupCapability(desktopShell)',
      factoryIndex
    )
    const activationFactoryIndex = source.indexOf(
      'desktopShell.createMacAppActivationHandler({',
      installIndex
    )
    const browserManagerIndex = source.indexOf(
      'const browserManager = browserKernel.browserManager',
      activationFactoryIndex
    )
    const certificateIndex = source.indexOf("'certificate-error'", browserManagerIndex)

    expect(importIndex).toBeGreaterThan(updaterIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(activationFactoryIndex).toBeGreaterThan(installIndex)
    expect(browserManagerIndex).toBeGreaterThan(activationFactoryIndex)
    expect(certificateIndex).toBeGreaterThan(browserManagerIndex)
  })

  it('preserves synchronous second-instance activation through the eager focus leaf', () => {
    const lockIndex = source.indexOf('acquireSingleInstanceLock(app, requestDesktopActivation)')
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const focusStart = source.indexOf('function focusExistingWindow(): void {')
    const focusEnd = source.indexOf('\n}', focusStart)
    const focusBlock = source.slice(focusStart, focusEnd)
    const gateStart = source.indexOf(
      'const desktopActivationGate = createServeDesktopActivationGate'
    )
    const gateEnd = source.indexOf('\n})', gateStart)
    const gateBlock = source.slice(gateStart, gateEnd)

    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(lockIndex).toBeLessThan(readyIndex)
    expect(focusBlock).toContain('focusExistingMainWindow({')
    expect(focusBlock).toContain('openWindow: openMainWindow')
    expect(gateBlock).toContain(
      'activateWindow: () => runDesktopActionWhenCoreIpcReady(focusExistingWindow)'
    )
  })

  it('retains menu, tray, activation, recreation, and serve-promotion consumers', () => {
    const i18nIndex = source.indexOf("logStartupMilestone('i18n-ready')")
    const menuIndex = source.indexOf('desktopShell.registerAppMenu({', i18nIndex)
    const terminalIndex = source.indexOf('startTerminalRuntimeStartupServices()', menuIndex)
    const activationIndex = source.indexOf(
      "app.on('activate', handleMacAppActivation)",
      terminalIndex
    )
    const serveIndex = source.indexOf('if (serveOptions) {', activationIndex)
    const windowOpenIndex = source.indexOf('Promise.resolve(openMainWindow())', serveIndex)

    expect(menuIndex).toBeGreaterThan(i18nIndex)
    expect(activationIndex).toBeGreaterThan(terminalIndex)
    expect(serveIndex).toBeGreaterThan(activationIndex)
    expect(windowOpenIndex).toBeGreaterThan(serveIndex)
    expect(source).toContain("window.on('show', notifyMainWindowBecameVisible)")
    expect(source).toContain("window.on('restore', notifyMainWindowBecameVisible)")
    expect(source).toContain("window.on('show', () => setTrayAttention(false))")
    expect(source).toContain('desktopShell.zoomDashboardPopoutIfFocused')
    expect(source).toContain('syncMacMenuBarIcon(settings.showMenuBarIcon !== false)')
  })

  it('keeps pre-install shutdown cleanup fail-closed and post-ready cleanup exact', () => {
    const willQuitIndex = source.indexOf("app.on('will-quit', (e) => {")
    const willQuitBlock = source.slice(willQuitIndex)

    expect(willQuitBlock).toContain(
      'getDesktopShellStartupCapabilityIfInstalled()?.destroySystemTray()'
    )
    expect(willQuitBlock).toContain(
      'getDesktopShellStartupCapabilityIfInstalled()?.setUnreadDockBadgeCount(0)'
    )
    expect(source).toContain('getDesktopShellStartupCapability().destroySystemTray()')
    expect(source).toContain('desktopShell.triggerStartupNotificationRegistration(store)')
  })
})
