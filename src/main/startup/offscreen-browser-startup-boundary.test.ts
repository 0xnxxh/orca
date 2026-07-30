import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/offscreen-browser-startup-capability')"
const capabilityAttach = 'attachOffscreenBrowserStartupCapability(runtime, browserManager)'

describe('offscreen browser startup boundary', () => {
  it('keeps the backend implementation out of the eager main graph', () => {
    const staticImports = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .map((declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text)

    expect(staticImports).not.toContain('./browser/offscreen-browser-backend')
    expect(source).not.toContain('new OffscreenBrowserBackend(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityAttach)).toHaveLength(2)
  })

  it('loads only within both serve and display gates', () => {
    const serveGateIndex = source.indexOf('if (serveOptions) {')
    const displayGateIndex = source.indexOf(
      'if (headlessBrowserDisplayAvailable) {',
      serveGateIndex
    )
    const importIndex = source.indexOf(capabilityImport, displayGateIndex)
    const attachIndex = source.indexOf(capabilityAttach, importIndex)
    const displayGateEndIndex = source.indexOf(
      '\n    // Why: headless servers have no renderer graph publisher;',
      attachIndex
    )

    expect(serveGateIndex).toBeGreaterThanOrEqual(0)
    expect(displayGateIndex).toBeGreaterThan(serveGateIndex)
    expect(importIndex).toBeGreaterThan(displayGateIndex)
    expect(attachIndex).toBeGreaterThan(importIndex)
    expect(displayGateEndIndex).toBeGreaterThan(attachIndex)
  })

  it('attaches before graph sync, RPC startup, activation, and readiness', () => {
    const attachIndex = source.indexOf(capabilityAttach)
    const graphSyncIndex = source.indexOf(
      'runtime.syncWindowGraph(HEADLESS_RUNTIME_WINDOW_ID',
      attachIndex
    )
    const rpcStartIndex = source.indexOf('await runtimeRpc.start()', graphSyncIndex)
    const activationIndex = source.indexOf('settleServeDesktopActivation()', rpcStartIndex)
    const readyIndex = source.indexOf('await printServeReady(serveOptions)', activationIndex)

    expect(attachIndex).toBeGreaterThanOrEqual(0)
    expect(graphSyncIndex).toBeGreaterThan(attachIndex)
    expect(rpcStartIndex).toBeGreaterThan(graphSyncIndex)
    expect(activationIndex).toBeGreaterThan(rpcStartIndex)
    expect(readyIndex).toBeGreaterThan(activationIndex)
  })

  it('keeps desktop startup outside the capability and committed teardown unchanged', () => {
    const serveReadyIndex = source.indexOf('await printServeReady(serveOptions)')
    const serveReturnIndex = source.indexOf('\n    return\n', serveReadyIndex)
    const desktopWindowIndex = source.indexOf('Promise.resolve(openMainWindow())', serveReturnIndex)
    const desktopRpcIndex = source.indexOf('runtimeRpc.start().then(', desktopWindowIndex)
    const teardownIndex = source.indexOf('runtime?.getOffscreenBrowserBackend()?.destroyAll?.()')

    expect(serveReturnIndex).toBeGreaterThan(serveReadyIndex)
    expect(desktopWindowIndex).toBeGreaterThan(serveReturnIndex)
    expect(desktopRpcIndex).toBeGreaterThan(desktopWindowIndex)
    expect(source.indexOf(capabilityImport, serveReturnIndex)).toBe(-1)
    expect(source).toContain("app.on('will-quit', (e) => {")
    expect(teardownIndex).toBeGreaterThan(source.indexOf("app.on('will-quit', (e) => {"))
  })
})
