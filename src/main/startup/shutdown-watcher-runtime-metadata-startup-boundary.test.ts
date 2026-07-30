import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/shutdown-watcher-runtime-metadata-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('shutdown watcher/runtime-metadata startup boundary', () => {
  it('moves only the five shutdown leaves behind one owner', () => {
    for (const moduleSpecifier of [
      './ipc/filesystem-watcher',
      './ipc/worktree-base-directory-watcher',
      './runtime/orca-runtime-files',
      './runtime/runtime-metadata',
      './quit-teardown-deadline'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./startup/shutdown-watcher-runtime-metadata-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after runtime connectivity and before resource creation', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const connectivityInstallIndex = source.indexOf(
      'installRuntimeConnectivityStartupCapability(runtimeConnectivity)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, connectivityInstallIndex)
    const factoryIndex = source.indexOf(
      'const shutdownWatcherRuntimeMetadata = createShutdownWatcherRuntimeMetadataStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installShutdownWatcherRuntimeMetadataStartupCapability(shutdownWatcherRuntimeMetadata)',
      factoryIndex
    )
    const runtimeRpcIndex = source.indexOf(
      'runtimeRpc = createOrcaRuntimeRpcServerStartupCapability({',
      installIndex
    )
    const coreIpcIndex = source.indexOf('await loadCoreIpcRegistryForDesktop()', installIndex)
    const windowIndex = source.indexOf('Promise.resolve(openMainWindow())', coreIpcIndex)

    expect(importIndex).toBeGreaterThan(connectivityInstallIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(runtimeRpcIndex).toBeGreaterThan(installIndex)
    expect(coreIpcIndex).toBeGreaterThan(installIndex)
    expect(windowIndex).toBeGreaterThan(coreIpcIndex)
  })

  it('makes only resource-free early quit optional without memoizing it', () => {
    const shutdownStart = source.indexOf('function shutdownWatchersOnce(): Promise<void> {')
    const shutdownEnd = source.indexOf('\n// Why: cursor-agent', shutdownStart)
    const shutdownBlock = source.slice(shutdownStart, shutdownEnd)
    const optionalIndex = shutdownBlock.indexOf(
      'getShutdownWatcherRuntimeMetadataStartupCapabilityIfInstalled()'
    )
    const earlyReturnIndex = shutdownBlock.indexOf('return Promise.resolve()', optionalIndex)
    const memoIndex = shutdownBlock.indexOf('if (!watcherShutdownPromise)', earlyReturnIndex)

    expect(optionalIndex).toBeGreaterThanOrEqual(0)
    expect(earlyReturnIndex).toBeGreaterThan(optionalIndex)
    expect(memoIndex).toBeGreaterThan(earlyReturnIndex)
    expect(shutdownBlock).toContain('shutdown.closeAllWatchers()')
    expect(shutdownBlock).toContain('shutdown.disposeWorktreeBaseDirectoryWatchers()')
  })

  it('preserves RPC stop, watcher drain, metadata clear, and teardown ordering', () => {
    const quitIndex = source.indexOf("app.on('will-quit', (e) => {")
    const quitBlock = source.slice(quitIndex)
    const statsIndex = quitBlock.indexOf('stats?.flush()')
    const ptyIndex = quitBlock.indexOf('terminalRuntime?.killAllPty()', statsIndex)
    const watcherIndex = quitBlock.indexOf(
      'const watcherShutdown = shutdownWatchersOnce()',
      ptyIndex
    )
    const rpcStopIndex = quitBlock.indexOf('.stop()', watcherIndex)
    const drainIndex = quitBlock.indexOf('.awaitRuntimeFileWatcherUnsubscribes()', rpcStopIndex)
    const clearIndex = quitBlock.indexOf('.clearRuntimeMetadataIfOwned(', drainIndex)
    const deadlineIndex = quitBlock.indexOf(
      'shutdownWatcherRuntimeMetadata.settleTeardownWithinDeadline([',
      clearIndex
    )

    expect(ptyIndex).toBeGreaterThan(statsIndex)
    expect(watcherIndex).toBeGreaterThan(ptyIndex)
    expect(rpcStopIndex).toBeGreaterThan(watcherIndex)
    expect(drainIndex).toBeGreaterThan(rpcStopIndex)
    expect(clearIndex).toBeGreaterThan(drainIndex)
    expect(deadlineIndex).toBeGreaterThan(clearIndex)
    expect(quitBlock).toContain(
      'getCanonicalUserDataPath(),\n                ownedPid,\n                ownedRuntimeId'
    )
    expect(quitBlock).toContain("{ name: 'watchers', promise: watcherShutdown }")
    expect(quitBlock).toContain(': Promise.resolve<string[]>([])')
  })

  it('keeps bootstrap, platform, runtime, mobile, relay, i18n, and shutdown owners intact', () => {
    for (const moduleSpecifier of [
      './startup/configure-process',
      './startup/gpu-fallback-marker',
      '../shared/cross-platform-path',
      './wsl',
      './agent-auth-restart-preservation',
      './i18n/main-i18n'
    ]) {
      expect(findImport(moduleSpecifier)).toBeDefined()
    }

    expect(source).toContain("app.on('before-quit', () => {")
    expect(source).toContain("app.on('will-quit', (e) => {")
    expect(source).toContain('const ownedPid = process.pid')
    expect(source).toContain('const ownedRuntimeId = runtime?.getRuntimeId()')
  })
})
