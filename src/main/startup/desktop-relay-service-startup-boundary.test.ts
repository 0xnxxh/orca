import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/desktop-relay-service-startup-capability')"
const capabilityFactory = 'const relayService = await createDesktopRelayServiceStartupCapability({'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('Desktop relay service startup boundary', () => {
  it('keeps the service type-only and the relay status contract eagerly type-only', () => {
    expect(findImport('./runtime/relay/desktop-relay-service')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./runtime/relay/relay-session-broker')?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new DesktopRelayService(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('loads only inside configured cloud auth after desktop window and RPC startup', () => {
    const desktopStartupIndex = source.indexOf('const [win, runtimeRpcStartResult] = await Promise')
    const rpcFailureIndex = source.indexOf('if (!runtimeRpcStartResult.ok)', desktopStartupIndex)
    const cloudAuthIndex = source.indexOf(
      'const cloudAuth = getOrcaCloudAuthConfig()',
      rpcFailureIndex
    )
    const configuredIndex = source.indexOf('if (cloudAuth.configured) {', cloudAuthIndex)
    const tryIndex = source.indexOf('try {', configuredIndex)
    const importIndex = source.indexOf(capabilityImport, tryIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const catchIndex = source.indexOf('} catch (error) {', factoryIndex)

    expect(desktopStartupIndex).toBeGreaterThanOrEqual(0)
    expect(rpcFailureIndex).toBeGreaterThan(desktopStartupIndex)
    expect(cloudAuthIndex).toBeGreaterThan(rpcFailureIndex)
    expect(configuredIndex).toBeGreaterThan(cloudAuthIndex)
    expect(tryIndex).toBeGreaterThan(configuredIndex)
    expect(importIndex).toBeGreaterThan(tryIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(catchIndex).toBeGreaterThan(factoryIndex)
  })

  it('assigns the live service before provider wiring, status publication, and start', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const assignmentIndex = source.indexOf('desktopRelayService = relayService', factoryIndex)
    const providerIndex = source.indexOf(
      'runtimeRpc.setMobileRelayPairingProvider({',
      assignmentIndex
    )
    const statusAssignmentIndex = source.indexOf('desktopRelayStatus = status', factoryIndex)
    const statusNotificationIndex = source.indexOf(
      "mainWindow?.webContents.send('mobile:relayStatusChanged', status)",
      statusAssignmentIndex
    )
    const startIndex = source.indexOf('relayService.start()', providerIndex)

    expect(source).toContain("let desktopRelayStatus: RelayBrokerStatus = 'offline'")
    expect(statusAssignmentIndex).toBeGreaterThan(factoryIndex)
    expect(statusNotificationIndex).toBeGreaterThan(statusAssignmentIndex)
    expect(assignmentIndex).toBeGreaterThan(factoryIndex)
    expect(providerIndex).toBeGreaterThan(assignmentIndex)
    expect(source.indexOf('relayService.createPairingRelay(', providerIndex)).toBeGreaterThan(
      providerIndex
    )
    expect(startIndex).toBeGreaterThan(providerIndex)
  })

  it('keeps auth mutation, sign-out, relaunch, and quit callbacks on the live service', () => {
    expect(source).toContain('desktopRelayService?.fenceAndCloseNow()')
    expect(source).toContain('onOrcaProfileAuthMutation: () => desktopRelayService?.authMutated()')
    expect(source).toContain(
      'onBeforeOrcaProfileSignOut: () => desktopRelayService?.fenceAndCloseNow()'
    )
    expect(source).toContain("app.on('before-quit', () => {")
    expect(source).toContain('runtimeRpc?.setMobileRelayPairingProvider(null)')
    expect(source).toContain("'[relay] Desktop relay startup unavailable:'")
  })
})
