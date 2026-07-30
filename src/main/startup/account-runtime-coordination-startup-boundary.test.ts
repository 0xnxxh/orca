import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/account-runtime-coordination-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('account-runtime coordination startup boundary', () => {
  it('removes every candidate eager index value behind one owner', () => {
    for (const moduleSpecifier of [
      './minimax/minimax-cookie-store',
      './rate-limits/claude-rate-limit-target',
      './rate-limits/codex-rate-limit-target',
      './rate-limits/account-runtime-target-sync',
      './claude-accounts/runtime-selection',
      './claude-accounts/live-pty-gate'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./startup/account-runtime-coordination-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after crash/hang and before its first consumer or Store construction', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const crashInstallIndex = source.indexOf(
      'installCrashHangRuntimeStartupCapability(crashHangRuntime)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, crashInstallIndex)
    const factoryIndex = source.indexOf(
      'const accountRuntimeCoordination = createAccountRuntimeCoordinationStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installAccountRuntimeCoordinationStartupCapability(accountRuntimeCoordination)',
      factoryIndex
    )
    const crashStoreIndex = source.indexOf(
      'crashReports = crashHangRuntime.CrashReportStore.fromUserData()',
      installIndex
    )
    const storeIndex = source.indexOf('store = createStoreStartupCapability(', crashStoreIndex)

    expect(importIndex).toBeGreaterThan(crashInstallIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(crashStoreIndex).toBeGreaterThan(installIndex)
    expect(storeIndex).toBeGreaterThan(crashStoreIndex)
  })

  it('preserves live-PTY hydration and account target ordering', () => {
    const storeIndex = source.indexOf('store = createStoreStartupCapability(')
    const attachIndex = source.indexOf(
      'accountRuntimeCoordination.attachClaudeLivePtyPersistence(store)',
      storeIndex
    )
    const drainIndex = source.indexOf(
      'accountRuntimeCoordination.onLiveClaudePtysDrained(() => {',
      attachIndex
    )
    const persistedIndex = source.indexOf(
      'const persistedClaudePtyIds = store.getClaudeLivePtySessionIds()',
      drainIndex
    )
    const seedIndex = source.indexOf(
      'accountRuntimeCoordination.seedLiveClaudePtysFromPersistence(persistedClaudePtyIds)',
      persistedIndex
    )
    const accountServicesIndex = source.indexOf(
      'const accountServices = createAccountServicesStartupCapability(',
      seedIndex
    )
    const codexTargetIndex = source.indexOf(
      'accountRuntimeCoordination.getInitialCodexRateLimitTarget(store.getSettings())',
      accountServicesIndex
    )
    const claudeTargetIndex = source.indexOf(
      'accountRuntimeCoordination.getInitialClaudeRateLimitTarget(store.getSettings())',
      codexTargetIndex
    )
    const syncIndex = source.indexOf(
      'accountRuntimeCoordination.createAccountRuntimeTargetSettingsSync(',
      claudeTargetIndex
    )

    expect(attachIndex).toBeGreaterThan(storeIndex)
    expect(drainIndex).toBeGreaterThan(attachIndex)
    expect(persistedIndex).toBeGreaterThan(drainIndex)
    expect(seedIndex).toBeGreaterThan(persistedIndex)
    expect(accountServicesIndex).toBeGreaterThan(seedIndex)
    expect(codexTargetIndex).toBeGreaterThan(accountServicesIndex)
    expect(claudeTargetIndex).toBeGreaterThan(codexTargetIndex)
    expect(syncIndex).toBeGreaterThan(claudeTargetIndex)
  })

  it('preserves deferred MiniMax and inactive Claude resolver identities', () => {
    const miniMaxResolverIndex = source.indexOf('rateLimits.setMiniMaxConfigResolver(() => {')
    const inactiveResolverIndex = source.indexOf(
      'rateLimits.setInactiveClaudeAccountsResolver(() => {',
      miniMaxResolverIndex
    )
    const inactiveResolverEnd = source.indexOf(
      'rateLimits.setInactiveCodexAccountsResolver(() => {',
      inactiveResolverIndex
    )
    const inactiveResolver = source.slice(inactiveResolverIndex, inactiveResolverEnd)

    expect(source.slice(miniMaxResolverIndex, inactiveResolverIndex)).toContain(
      'getAccountRuntimeCoordinationStartupCapability().readMiniMaxSessionCookie()'
    )
    expect(
      inactiveResolver.match(
        /getAccountRuntimeCoordinationStartupCapability\(\)\.normalizeClaudeRuntimeSelection/g
      )
    ).toHaveLength(2)
  })

  it('keeps unrelated path, WSL, and restart-preservation leaves eager', () => {
    expect(findImport('../shared/cross-platform-path')).toBeDefined()
    expect(findImport('./wsl')).toBeDefined()
    expect(findImport('./agent-auth-restart-preservation')).toBeDefined()

    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const preReadySource = source.slice(0, readyIndex)
    for (const value of [
      'readMiniMaxSessionCookie(',
      'getInitialClaudeRateLimitTarget(',
      'getInitialCodexRateLimitTarget(',
      'createAccountRuntimeTargetSettingsSync(',
      'normalizeClaudeRuntimeSelection(',
      'attachClaudeLivePtyPersistence(',
      'onLiveClaudePtysDrained(',
      'seedLiveClaudePtysFromPersistence('
    ]) {
      expect(preReadySource).not.toContain(value)
    }
  })
})
