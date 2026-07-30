import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/runtime-connectivity-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('runtime connectivity startup boundary', () => {
  it('moves only the app-ready connectivity leaves behind one owner', () => {
    for (const moduleSpecifier of [
      './ipc/mobile',
      './runtime/agent-session-claim-identity',
      './ipc/runtime-environment-transport-routing',
      '../shared/runtime-environment-store',
      '../shared/runtime-environments',
      './runtime/pairing-endpoint'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(
      findImport('./runtime/orchestration/environment-transport')?.importClause?.isTypeOnly
    ).toBe(true)
    expect(findImport('./startup/runtime-connectivity-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs before every connectivity consumer', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const importIndex = source.indexOf(capabilityImport, readyIndex)
    const factoryIndex = source.indexOf(
      'const runtimeConnectivity = createRuntimeConnectivityStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installRuntimeConnectivityStartupCapability(runtimeConnectivity)',
      factoryIndex
    )
    const runtimeTransportIndex = source.indexOf(
      'const orchestrationEnvironmentTransport: OrchestrationEnvironmentTransport = {',
      installIndex
    )
    const signerIndex = source.indexOf(
      'agentSessionClaimSigner: runtimeConnectivity.loadAgentSessionClaimSigner(',
      runtimeTransportIndex
    )
    const mobileIndex = source.indexOf(
      'runtimeConnectivity.registerMobileHandlers(runtimeRpc, {',
      signerIndex
    )
    const serveReadyIndex = source.indexOf('await printServeReady(serveOptions)', mobileIndex)

    expect(importIndex).toBeGreaterThan(readyIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(runtimeTransportIndex).toBeGreaterThan(installIndex)
    expect(signerIndex).toBeGreaterThan(runtimeTransportIndex)
    expect(mobileIndex).toBeGreaterThan(signerIndex)
    expect(serveReadyIndex).toBeGreaterThan(mobileIndex)
  })

  it('preserves the original runtime transport and mobile option expressions', () => {
    const transportIndex = source.indexOf(
      'const orchestrationEnvironmentTransport: OrchestrationEnvironmentTransport = {'
    )
    const runtimeFactoryIndex = source.indexOf(
      'const runtimeService = createOrcaRuntimeServiceStartupCapability(',
      transportIndex
    )
    const transport = source.slice(transportIndex, runtimeFactoryIndex)
    const runtimeRpcIndex = source.indexOf(
      'runtimeRpc = createOrcaRuntimeRpcServerStartupCapability({'
    )
    const mobileIndex = source.indexOf(
      'runtimeConnectivity.registerMobileHandlers(runtimeRpc, {',
      runtimeRpcIndex
    )
    const mobileEnd = source.indexOf(
      'runtimeRpc.setOnUnpairedDeviceAuthFailure(() => {',
      mobileIndex
    )
    const mobile = source.slice(mobileIndex, mobileEnd)

    expect(transport).toContain("app.getPath('userData'), selector")
    expect(transport).toContain('pairing.publicKeyB64')
    expect(transport).toContain('timeoutMs,')
    expect(transport).toContain('undefined,')
    expect(transport).toContain('envelope')
    expect(mobile).toContain('getRelayStatus: () => desktopRelayStatus')
    expect(mobile).toContain('consumePendingUnpairedDeviceAuthFailure: (webContentsId) => {')
  })

  it('keeps bootstrap, platform policy, and shutdown ownership eager', () => {
    for (const moduleSpecifier of [
      './startup/configure-process',
      './startup/gpu-fallback-marker',
      '../shared/cross-platform-path',
      './wsl',
      './agent-auth-restart-preservation',
      './runtime/orca-runtime-files',
      './runtime/runtime-metadata'
    ]) {
      expect(findImport(moduleSpecifier)).toBeDefined()
    }

    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const preReady = source.slice(0, readyIndex)
    expect(preReady).not.toContain('runtimeConnectivity.')
    expect(preReady).not.toContain('createRuntimeConnectivityStartupCapability()')
  })
})
