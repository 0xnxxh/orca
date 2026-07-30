import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const source = readFileSync(join(projectRoot, 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/cli-wsl-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityFactory = 'const cliWslStartupCapability = createCliWslStartupCapability()'

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

describe('CLI and WSL startup boundary', () => {
  it('removes all three eager index values behind one dynamic aggregate capability', () => {
    expect(findImport('./cli/cli-installer')).toBeUndefined()
    expect(findImport('./cli/linux-bare-orca-dispatcher')).toBeUndefined()
    expect(findImport('./cli/wsl-cli-registration-reconciliation')).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('keeps the production value imports in the aggregate capability', () => {
    const capabilityPath = join(projectRoot, 'src/main/startup/cli-wsl-startup-capability.ts')
    const productionSources = listProductionTypeScriptFiles(join(projectRoot, 'src/main')).map(
      (filePath) => ({ filePath, source: readFileSync(filePath, 'utf8') })
    )
    const capabilitySource = productionSources.find(
      ({ filePath }) => filePath === capabilityPath
    )?.source

    expect(capabilitySource).toContain("import { CliInstaller } from '../cli/cli-installer'")
    expect(capabilitySource).toContain(
      "import { installLinuxBareOrcaDispatcher } from '../cli/linux-bare-orca-dispatcher'"
    )
    expect(capabilitySource).toContain(
      "import { reconcileManagedWslCliRegistrations } from '../cli/wsl-cli-registration-reconciliation'"
    )
  })

  it('loads after app naming and before the original reconciliation status transition', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const setNameIndex = source.indexOf('app.setName(devInstanceIdentity.appName)', readyIndex)
    const importIndex = source.indexOf(capabilityImport, setNameIndex)
    const factoryIndex = source.indexOf(capabilityFactory, importIndex)
    const pendingIndex = source.indexOf(
      "managedWslCliReconciliationStatus = 'pending'",
      factoryIndex
    )

    expect(setNameIndex).toBeGreaterThan(readyIndex)
    expect(importIndex).toBeGreaterThan(setNameIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(pendingIndex).toBeGreaterThan(factoryIndex)
  })

  it('preserves reconciliation inputs, status logging, failure handling, and one shared barrier', () => {
    const reconciliationIndex = source.indexOf('.reconcileManagedWslCliRegistrations({')
    const barrierCreationIndex = source.indexOf(
      'managedWslCliStartupBarrierReady = createWslCliReconciliationStartupBarrier(',
      reconciliationIndex
    )
    const firstWindowBarrierIndex = source.indexOf(
      'Promise.all([firstWindowStartupServicesReady, managedWslCliStartupBarrierReady])'
    )
    const serveBarrierIndex = source.indexOf(
      'await managedWslCliStartupBarrierReady',
      barrierCreationIndex
    )
    const reconciliationBlock = source.slice(reconciliationIndex, barrierCreationIndex)

    expect(reconciliationBlock).toContain('isPackaged: app.isPackaged,')
    expect(reconciliationBlock).toContain('userDataPath: getCanonicalUserDataPath(),')
    expect(reconciliationBlock).toContain('appVersion: app.getVersion()')
    expect(reconciliationBlock).toContain("result.outcome === 'failed'")
    expect(reconciliationBlock).toContain("result.outcome === 'repaired'")
    expect(reconciliationBlock).toContain("managedWslCliReconciliationStatus = 'settled'")
    expect(reconciliationBlock).toContain("managedWslCliReconciliationStatus = 'failed'")
    expect(reconciliationBlock).toContain(
      '[wsl-cli] Managed registration reconciliation discovery failed:'
    )
    expect(source.slice(barrierCreationIndex, barrierCreationIndex + 180)).toContain(
      'managedWslCliReconciliationReady'
    )
    expect(firstWindowBarrierIndex).toBeGreaterThan(-1)
    expect(serveBarrierIndex).toBeGreaterThan(firstWindowBarrierIndex)
  })

  it('keeps serve-only platform gates, install behavior, dispatcher inputs, and readiness order', () => {
    const serveIndex = source.indexOf('if (serveOptions) {')
    const barrierIndex = source.indexOf('await managedWslCliStartupBarrierReady', serveIndex)
    const rpcIndex = source.indexOf('await runtimeRpc.start()', barrierIndex)
    const installGateIndex = source.indexOf(
      "if (process.platform === 'darwin' || process.platform === 'linux')",
      rpcIndex
    )
    const installIndex = source.indexOf(
      'cliWslStartupCapability.installServeCli({',
      installGateIndex
    )
    const dispatcherGateIndex = source.indexOf(
      "if (process.platform === 'linux' && app.isPackaged && process.resourcesPath)",
      installIndex
    )
    const dispatcherIndex = source.indexOf(
      'cliWslStartupCapability.installLinuxBareOrcaDispatcher({',
      dispatcherGateIndex
    )
    const readinessIndex = source.indexOf('await printServeReady(serveOptions)', dispatcherIndex)
    const installBlock = source.slice(installIndex, dispatcherGateIndex)
    const dispatcherBlock = source.slice(dispatcherIndex, readinessIndex)

    expect(barrierIndex).toBeGreaterThan(serveIndex)
    expect(rpcIndex).toBeGreaterThan(barrierIndex)
    expect(installGateIndex).toBeGreaterThan(rpcIndex)
    expect(installIndex).toBeGreaterThan(installGateIndex)
    expect(installBlock).toContain(
      'serve CLI auto-install must not request administrator privileges'
    )
    expect(installBlock).toContain('[serve] orca CLI install skipped:')
    expect(dispatcherGateIndex).toBeGreaterThan(installIndex)
    expect(dispatcherIndex).toBeGreaterThan(dispatcherGateIndex)
    expect(dispatcherBlock).toContain('resourcesPath: process.resourcesPath')
    expect(dispatcherBlock).toContain('[serve] bare orca dispatcher install skipped:')
    expect(readinessIndex).toBeGreaterThan(dispatcherIndex)
  })
})
