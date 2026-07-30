import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const mainRoot = join(projectRoot, 'src/main')
const indexSource = readFileSync(join(mainRoot, 'index.ts'), 'utf8')
const indexSourceFile = ts.createSourceFile('index.ts', indexSource, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/store-startup-capability')"
const capabilityFactory =
  'store = createStoreStartupCapability({ dataFile: activeOrcaProfile.dataFile })'

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

function findIndexImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return indexSourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('Store startup boundary', () => {
  it('keeps Store type-only in index behind one startup capability', () => {
    expect(findIndexImport('./persistence')?.importClause?.isTypeOnly).toBe(true)
    expect(findIndexImport('./persistence-data-path')?.importClause?.isTypeOnly).toBe(false)
    expect(indexSource).not.toContain('new Store(')
    expect(indexSource.split(capabilityImport)).toHaveLength(2)
    expect(indexSource.split(capabilityFactory)).toHaveLength(2)
  })

  it('keeps the sole production Store value import and constructor in the capability', () => {
    const capabilityPath = join(mainRoot, 'startup/store-startup-capability.ts')
    const productionSources = listProductionTypeScriptFiles(mainRoot).map((filePath) => ({
      filePath,
      source: readFileSync(filePath, 'utf8')
    }))
    const valueImporters = productionSources
      .filter(({ source }) => source.includes("import { Store } from '../persistence'"))
      .map(({ filePath }) => filePath)
    const constructors = productionSources
      .filter(({ source }) => source.includes('new Store(...args)'))
      .map(({ filePath }) => filePath)

    expect(valueImporters).toEqual([capabilityPath])
    expect(constructors).toEqual([capabilityPath])
  })

  it('routes production path consumers through the narrow shared module', () => {
    const productionSources = listProductionTypeScriptFiles(mainRoot).map((filePath) => ({
      filePath,
      source: readFileSync(filePath, 'utf8')
    }))
    const stalePathImports = productionSources.filter(
      ({ source }) =>
        source.includes("getCanonicalUserDataPath } from '../persistence'") ||
        source.includes("getCanonicalUserDataPath } from './persistence'")
    )

    expect(stalePathImports).toEqual([])
    expect(indexSource).toContain("} from './persistence-data-path'")
    expect(readFileSync(join(mainRoot, 'ipc/cli.ts'), 'utf8')).toContain(
      "from '../persistence-data-path'"
    )
    expect(readFileSync(join(mainRoot, 'macos-tcc-prompt-notice.ts'), 'utf8')).toContain(
      "from './persistence-data-path'"
    )
    expect(readFileSync(join(mainRoot, 'serve-update-handoff.ts'), 'utf8')).toContain(
      "from './persistence-data-path'"
    )
    expect(
      readFileSync(join(mainRoot, 'ssh/ssh-remote-cli-host-passthrough.ts'), 'utf8')
    ).toContain("from '../persistence-data-path'")
  })

  it('preserves early path capture and exact Store construction order', () => {
    const initIndex = indexSource.indexOf('initDataPath()')
    const appNameIndex = indexSource.indexOf('app.setName(devInstanceIdentity.appName)')
    const profileIndex = indexSource.indexOf('const activeOrcaProfile = ensureActiveOrcaProfile()')
    const importIndex = indexSource.indexOf(capabilityImport, profileIndex)
    const factoryIndex = indexSource.indexOf(capabilityFactory, importIndex)
    const milestoneIndex = indexSource.indexOf("logStartupMilestone('store-loaded')", factoryIndex)

    expect(initIndex).toBeGreaterThanOrEqual(0)
    expect(appNameIndex).toBeGreaterThan(initIndex)
    expect(profileIndex).toBeGreaterThan(appNameIndex)
    expect(importIndex).toBeGreaterThan(profileIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(milestoneIndex).toBeGreaterThan(factoryIndex)
  })

  it('keeps hydration, services, startup branches, and teardown after assignment', () => {
    const factoryIndex = indexSource.indexOf(capabilityFactory)
    const orderedConsumers = [
      'setDefaultWslDistroOverride(store.getSettings().terminalWindowsWslDistro ?? null)',
      'store.onSettingsChanged((updates, settings) => {',
      'attachClaudeLivePtyPersistence(store)',
      'applyAppIcon(store.getSettings().appIcon)',
      'initTelemetry(store)',
      'initCohortClassifier(store)',
      'createClaudeUsageStoreStartupCapability(store)',
      'createAccountServicesStartupCapability(store, {',
      'createOrcaRuntimeServiceStartupCapability(store, stats, {',
      'registerMobileHandlers(runtimeRpc, {',
      'if (serveOptions) {'
    ]
    let previousIndex = factoryIndex

    for (const consumer of orderedConsumers) {
      const consumerIndex = indexSource.indexOf(consumer, previousIndex)
      expect(consumerIndex).toBeGreaterThan(previousIndex)
      previousIndex = consumerIndex
    }

    const desktopIndex = indexSource.indexOf(
      'const [win, runtimeRpcStartResult] = await Promise',
      previousIndex
    )
    const quitIndex = indexSource.indexOf("app.on('will-quit'")
    const flushIndex = indexSource.indexOf('store?.flush()', quitIndex)

    expect(desktopIndex).toBeGreaterThan(previousIndex)
    expect(flushIndex).toBeGreaterThan(quitIndex)
  })
})
