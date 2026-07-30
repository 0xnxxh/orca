import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/agent-hook-runtime-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('agent-hook runtime startup boundary', () => {
  it('removes every eager index value import behind one typed seam', () => {
    for (const moduleSpecifier of [
      './agent-hooks/install-telemetry',
      './agent-hooks/managed-agent-hook-controls',
      './agent-hooks/server',
      './agent-hooks/hook-provider-session-invalidation',
      './agent-hooks/wsl-hook-relay-manager',
      './agent-hooks/first-work-branch-rename',
      './agent-hooks/branch-rename-failure-output',
      './agent-hooks/first-work-folder-rename',
      './agent-hooks/migration-unsupported-pty-state'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./startup/agent-hook-runtime-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)?.importClause?.isTypeOnly).toBe(true)
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after retained app-ready capabilities and before every consumer', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const desktopInstallIndex = source.indexOf(
      'installDesktopShellStartupCapability(desktopShell)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, desktopInstallIndex)
    const factoryIndex = source.indexOf(
      'const agentHooks = createAgentHookRuntimeStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installAgentHookRuntimeStartupCapability(agentHooks)',
      factoryIndex
    )
    const browserManagerIndex = source.indexOf(
      'const browserManager = browserKernel.browserManager',
      installIndex
    )
    const storeIndex = source.indexOf('store = createStoreStartupCapability(', browserManagerIndex)
    const runtimeIndex = source.indexOf('createOrcaRuntimeServiceStartupCapability(', storeIndex)
    const terminalStartIndex = source.indexOf('startTerminalRuntimeStartupServices()', runtimeIndex)

    expect(importIndex).toBeGreaterThan(desktopInstallIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(browserManagerIndex).toBeGreaterThan(installIndex)
    expect(storeIndex).toBeGreaterThan(browserManagerIndex)
    expect(runtimeIndex).toBeGreaterThan(storeIndex)
    expect(terminalStartIndex).toBeGreaterThan(runtimeIndex)
  })

  it('preserves the hook-server start contract and runtime identity', () => {
    const startupStart = source.indexOf('function startTerminalRuntimeStartupServices():')
    const startupEnd = source.indexOf('\nfunction prepareCodexRuntimeHomeForLaunch', startupStart)
    const startupBlock = source.slice(startupStart, startupEnd)
    const runtimeStart = source.indexOf('createOrcaRuntimeServiceStartupCapability(')
    const runtimeEnd = source.indexOf('\n  runtime = runtimeService', runtimeStart)
    const runtimeBlock = source.slice(runtimeStart, runtimeEnd)

    expect(startupBlock).toContain('getAgentHookRuntimeStartupCapability()')
    expect(startupBlock).toContain('if (!isAgentStatusHooksEnabled(store?.getSettings()))')
    expect(startupBlock).toContain('await agentHookServer.start({')
    expect(startupBlock).toContain("env: app.isPackaged ? 'production' : 'development'")
    expect(startupBlock).toContain("userDataPath: app.getPath('userData')")
    expect(startupBlock).toContain('endpointNamespace: devAgentHookEndpointNamespace')
    expect(runtimeBlock).toContain('agentHooks.agentHookServer.ingestTerminalStatus(event)')
    expect(runtimeBlock).toContain('agentHooks.agentHookServer.getStatusSnapshot()')
    expect(runtimeBlock).toContain('agentHooks.agentHookServer.buildPtyEnv()')
  })

  it('preserves first-work, migration, managed-install, and listener ordering', () => {
    const renameStart = source.indexOf('function maybeAutoRenameBranchOnFirstWorkFromHook(')
    const renameEnd = source.indexOf('\nconst devInstanceIdentity', renameStart)
    const renameBlock = source.slice(renameStart, renameEnd)
    const windowStart = source.indexOf('function openMainWindow(): BrowserWindow')
    const windowEnd = source.indexOf('\nfunction sendOpenFeatureTour', windowStart)
    const windowBlock = source.slice(windowStart, windowEnd)
    const managedIndex = source.indexOf('if (shouldInstallManagedHooks(is.dev))')
    const childProcessIndex = source.indexOf("app.on('child-process-gone'", managedIndex)

    expect(renameBlock).toContain('maybeAutoRenameBranchOnFirstWork(')
    expect(renameBlock).toContain('rememberBranchRenameFailureOutput(worktreeId, null)')
    expect(renameBlock).toContain('renameWorktreeFolderOnFirstWork(worktreeId, newLeaf, {')
    expect(renameBlock).toContain('moveWorktree')
    expect(windowBlock).toContain('agentHookServer.setListener(')
    expect(windowBlock).toContain('agentHookServer.setPaneStatusClearListener(')
    expect(windowBlock).toContain('setMigrationUnsupportedPtyListener(')
    expect(source.slice(managedIndex, childProcessIndex)).toContain(
      'agentHooks.runManagedHookInstallers(agentHooks.MANAGED_AGENT_HOOK_INSTALLERS)'
    )
    expect(source.slice(managedIndex, childProcessIndex)).toContain(
      'agentHooks.removeManagedAgentHooks()'
    )
  })

  it('keeps early quit safe and exact post-install teardown identities', () => {
    const willQuitIndex = source.indexOf("app.on('will-quit', (e) => {")
    const willQuitBlock = source.slice(willQuitIndex)

    expect(willQuitBlock).toContain(
      'const agentHooks = getAgentHookRuntimeStartupCapabilityIfInstalled()'
    )
    expect(willQuitBlock).toContain('agentHooks?.agentHookServer.stop()')
    expect(willQuitBlock).toContain('agentHooks?.wslHookRelayManager.disposeAll()')
  })
})
