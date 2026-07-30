import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const source = readFileSync(join(projectRoot, 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/runtime-rpc-server-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`
const capabilityFactory = 'runtimeRpc = createOrcaRuntimeRpcServerStartupCapability({'

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

describe('runtime RPC server startup boundary', () => {
  it('keeps index type-only with one dynamic aggregate capability', () => {
    expect(findImport('./runtime/runtime-rpc')?.importClause?.isTypeOnly).toBe(true)
    expect(source).not.toContain('new OrcaRuntimeRpcServer(')
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('keeps the sole production constructor and value import in the capability', () => {
    const capabilityPath = join(
      projectRoot,
      'src/main/startup/runtime-rpc-server-startup-capability.ts'
    )
    const productionSources = listProductionTypeScriptFiles(join(projectRoot, 'src/main')).map(
      (filePath) => ({ filePath, source: readFileSync(filePath, 'utf8') })
    )
    const valueImporters = productionSources
      .filter(({ source: fileSource }) =>
        fileSource.includes("import { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'")
      )
      .map(({ filePath }) => filePath)
    const constructors = productionSources
      .filter(({ source: fileSource }) => fileSource.includes('new OrcaRuntimeRpcServer('))
      .map(({ filePath }) => filePath)

    expect(valueImporters).toEqual([capabilityPath])
    expect(constructors).toEqual([capabilityPath])
  })

  it('loads at the former constructor point and immediately assigns the live server', () => {
    const serveOptionsIndex = source.indexOf('let serveOptions: ServeOptions | null = null')
    const serveResolutionIndex = source.indexOf(
      'serveOptions = isServeMode ? getServeOptions() : null',
      serveOptionsIndex
    )
    const pairingMigrationIndex = source.indexOf(
      "migrateMobilePairingDataToCanonicalUserDataPath(app.getPath('userData'))",
      serveResolutionIndex
    )
    const importIndex = source.indexOf(capabilityImport, pairingMigrationIndex)
    const assignmentIndex = source.indexOf(capabilityFactory, importIndex)
    const mobileHandlersIndex = source.indexOf(
      'registerMobileHandlers(runtimeRpc, {',
      assignmentIndex
    )

    expect(serveResolutionIndex).toBeGreaterThan(serveOptionsIndex)
    expect(pairingMigrationIndex).toBeGreaterThan(serveResolutionIndex)
    expect(importIndex).toBeGreaterThan(pairingMigrationIndex)
    expect(assignmentIndex).toBeGreaterThan(importIndex)
    expect(mobileHandlersIndex).toBeGreaterThan(assignmentIndex)
  })

  it('preserves every constructor option expression in order', () => {
    const assignmentIndex = source.indexOf(capabilityFactory)
    const mobileHandlersIndex = source.indexOf(
      'registerMobileHandlers(runtimeRpc, {',
      assignmentIndex
    )
    const construction = source.slice(assignmentIndex, mobileHandlersIndex)
    const identities = [
      'runtime,',
      'userDataPath: getCanonicalUserDataPath(),',
      'enableWebSocket: true,',
      '...(isE2E ? { wsPort: e2eWsPort } : {}),',
      '...(devWsPort !== undefined ? { wsPort: devWsPort } : {}),',
      '...(serveOptions?.wsPort !== undefined',
      'wsPort: serveOptions.wsPort,',
      'preferPinnedWsPort: true',
      'webClientRoot: getBundledWebClientRoot()'
    ]
    let previousIndex = -1

    for (const identity of identities) {
      const identityIndex = construction.indexOf(identity, previousIndex + 1)
      expect(identityIndex).toBeGreaterThan(previousIndex)
      previousIndex = identityIndex
    }
  })

  it('keeps every downstream lifecycle consumer on the assigned singleton', () => {
    const assignmentIndex = source.indexOf(capabilityFactory)
    const orderedConsumers = [
      'registerMobileHandlers(runtimeRpc, {',
      'runtimeRpc.setOnUnpairedDeviceAuthFailure(() => {',
      'startTerminalRuntimeStartupServices()',
      "app.on('activate', handleMacAppActivation)",
      'if (serveOptions) {'
    ]
    let previousIndex = assignmentIndex

    for (const consumer of orderedConsumers) {
      const consumerIndex = source.indexOf(consumer, previousIndex)
      expect(consumerIndex).toBeGreaterThan(previousIndex)
      previousIndex = consumerIndex
    }

    const serveStartIndex = source.indexOf('await runtimeRpc.start()', previousIndex)
    const desktopStartIndex = source.indexOf(
      'const [win, runtimeRpcStartResult] = await Promise',
      serveStartIndex
    )
    const desktopRpcIndex = source.indexOf('runtimeRpc.start().then(', desktopStartIndex)
    const relayIndex = source.indexOf('runtimeRpc,', desktopRpcIndex)
    const quitIndex = source.indexOf("app.on('will-quit'")
    const stopIndex = source.indexOf('.stop()', quitIndex)

    expect(serveStartIndex).toBeGreaterThan(previousIndex)
    expect(desktopStartIndex).toBeGreaterThan(serveStartIndex)
    expect(desktopRpcIndex).toBeGreaterThan(desktopStartIndex)
    expect(relayIndex).toBeGreaterThan(desktopRpcIndex)
    expect(stopIndex).toBeGreaterThan(quitIndex)
  })
})
