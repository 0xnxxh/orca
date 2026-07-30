import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/codex-launch-session-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('Codex launch/session startup boundary', () => {
  it('removes every targeted eager index value import behind one typed seam', () => {
    for (const moduleSpecifier of [
      './agent-trust-presets',
      './codex/hook-service',
      './codex/codex-real-home-hook-install',
      './codex/codex-trust-grant-telemetry',
      './codex/codex-session-backfill',
      './codex/codex-session-index-heal',
      './codex/codex-session-migration-scheduler',
      './codex/codex-legacy-session-resume',
      './codex/codex-session-source-home',
      './codex/codex-session-resume-preparation',
      './codex/codex-home-paths'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./codex-accounts/runtime-selection')?.importClause?.isTypeOnly).toBe(true)
    expect(findImport('./startup/codex-launch-session-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after agent hooks and before Store or any live Codex consumer', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const agentHookInstallIndex = source.indexOf(
      'installAgentHookRuntimeStartupCapability(agentHooks)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, agentHookInstallIndex)
    const factoryIndex = source.indexOf(
      'const codexLaunchSession = createCodexLaunchSessionStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installCodexLaunchSessionStartupCapability(codexLaunchSession)',
      factoryIndex
    )
    const storeIndex = source.indexOf('store = createStoreStartupCapability(', installIndex)
    const telemetryIndex = source.indexOf(
      'codexLaunchSession.setCodexTrustGrantTelemetry(',
      storeIndex
    )
    const accountIndex = source.indexOf('createAccountServicesStartupCapability(', telemetryIndex)
    const runtimeIndex = source.indexOf('createOrcaRuntimeServiceStartupCapability(', accountIndex)
    const terminalIndex = source.indexOf('startTerminalRuntimeStartupServices()', runtimeIndex)

    expect(importIndex).toBeGreaterThan(agentHookInstallIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(storeIndex).toBeGreaterThan(installIndex)
    expect(telemetryIndex).toBeGreaterThan(storeIndex)
    expect(accountIndex).toBeGreaterThan(telemetryIndex)
    expect(runtimeIndex).toBeGreaterThan(accountIndex)
    expect(terminalIndex).toBeGreaterThan(runtimeIndex)
  })

  it('keeps predeclared launch, resume, and window consumers fail closed', () => {
    const launchStart = source.indexOf('function prepareCodexRuntimeHomeForLaunch(')
    const resumeStart = source.indexOf(
      'async function prepareCodexSessionResumeForLaunch(',
      launchStart
    )
    const windowStart = source.indexOf('function openMainWindow(): BrowserWindow', resumeStart)
    const windowEnd = source.indexOf('\nfunction sendOpenFeatureTour', windowStart)

    expect(source.slice(launchStart, resumeStart)).toContain(
      'getCodexLaunchSessionStartupCapability()'
    )
    expect(source.slice(resumeStart, windowStart)).toContain(
      'getCodexLaunchSessionStartupCapability()'
    )
    expect(source.slice(windowStart, windowEnd)).toContain(
      'getCodexLaunchSessionStartupCapability()'
    )
  })

  it('preserves migration, trust telemetry, and runtime callback identities and order', () => {
    const telemetryIndex = source.indexOf('codexLaunchSession.setCodexTrustGrantTelemetry(')
    const observabilityIndex = source.indexOf('initObservability()', telemetryIndex)
    const migrationIndex = source.indexOf(
      'codexLaunchSession.createCodexSessionMigrationScheduler({',
      observabilityIndex
    )
    const runtimeIndex = source.indexOf(
      'createOrcaRuntimeServiceStartupCapability(',
      migrationIndex
    )
    const runtimeBlock = source.slice(
      runtimeIndex,
      source.indexOf('\n  runtime = runtimeService', runtimeIndex)
    )

    expect(observabilityIndex).toBeGreaterThan(telemetryIndex)
    expect(migrationIndex).toBeGreaterThan(observabilityIndex)
    expect(source.slice(migrationIndex, runtimeIndex)).toContain(
      'startBackfill: codexLaunchSession.startCodexSessionBackfillInBackground'
    )
    expect(source.slice(migrationIndex, runtimeIndex)).toContain(
      'startIndexHeal: codexLaunchSession.startCodexSessionIndexHealInBackground'
    )
    expect(runtimeBlock).toContain(
      'codexLaunchSession.prepareLegacySharedCodexSessionResume(args, {'
    )
    expect(runtimeBlock).toContain('codexLaunchSession.resolveHostCodexSessionSourceHome(')
  })
})
