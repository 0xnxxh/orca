import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityImport = "await import('./startup/account-services-startup-capability')"
const capabilityFactory = 'const accountServices = createAccountServicesStartupCapability(store, {'

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('account services startup boundary', () => {
  it('keeps all five implementations out of the eager main graph', () => {
    const serviceModules = [
      './rate-limits/service',
      './codex-accounts/runtime-home-service',
      './codex-accounts/service',
      './claude-accounts/runtime-auth-service',
      './claude-accounts/service'
    ]

    for (const moduleSpecifier of serviceModules) {
      expect(findImport(moduleSpecifier)?.importClause?.isTypeOnly).toBe(true)
    }
    expect(source).not.toMatch(
      /new (RateLimitService|CodexRuntimeHomeService|CodexAccountService|ClaudeRuntimeAuthService|ClaudeAccountService)\(/
    )
    expect(source.split(capabilityImport)).toHaveLength(2)
    expect(source.split(capabilityFactory)).toHaveLength(2)
  })

  it('keeps Codex configuration and migration policy in the composition root', () => {
    const factoryIndex = source.indexOf(capabilityFactory)
    const configureIndex = source.indexOf('configureCodexRuntimeHome: (runtimeHome) => {')
    const laneGateIndex = source.indexOf('runtimeHome.setRealHomeLaneGate(', configureIndex)
    const sweepIndex = source.indexOf('setSystemCodexHomeHookSweepSuppressed(', laneGateIndex)
    const schedulerIndex = source.indexOf('createCodexSessionMigrationScheduler({', sweepIndex)
    const lifecycleIndex = source.indexOf(
      'onHostSystemDefaultSelected: codexSessionMigration.requestRun',
      schedulerIndex
    )
    const initialRunIndex = source.indexOf(
      'afterCodexAccountCreated: codexSessionMigration.scheduleInitialRun',
      lifecycleIndex
    )

    expect(configureIndex).toBeGreaterThan(factoryIndex)
    expect(laneGateIndex).toBeGreaterThan(configureIndex)
    expect(sweepIndex).toBeGreaterThan(laneGateIndex)
    expect(schedulerIndex).toBeGreaterThan(sweepIndex)
    expect(lifecycleIndex).toBeGreaterThan(schedulerIndex)
    expect(initialRunIndex).toBeGreaterThan(lifecycleIndex)
  })

  it('assigns every returned singleton before rate-limit and runtime wiring', () => {
    const openCodeUsageIndex = source.indexOf(
      'openCodeUsage = await createOpenCodeUsageStoreStartupCapability(store)'
    )
    const importIndex = source.indexOf(capabilityImport, openCodeUsageIndex)
    const factoryIndex = source.indexOf(capabilityFactory)
    const assignments = [
      'rateLimits = accountServices.rateLimits',
      'codexRuntimeHome = accountServices.codexRuntimeHome',
      'codexAccounts = accountServices.codexAccounts',
      'claudeRuntimeAuth = accountServices.claudeRuntimeAuth',
      'claudeAccounts = accountServices.claudeAccounts'
    ]
    let previousIndex = factoryIndex
    for (const assignment of assignments) {
      const assignmentIndex = source.indexOf(assignment, previousIndex)
      expect(assignmentIndex).toBeGreaterThan(previousIndex)
      previousIndex = assignmentIndex
    }

    const resolverIndex = source.indexOf('rateLimits.setCodexHomePathResolver(', previousIndex)
    const runtimeIndex = source.indexOf(
      'runtimeService.setAccountServices({ claudeAccounts, codexAccounts, rateLimits })',
      resolverIndex
    )
    const initializedIndex = source.indexOf("logStartupMilestone('services-initialized')")

    expect(importIndex).toBeGreaterThan(openCodeUsageIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(resolverIndex).toBeGreaterThan(previousIndex)
    expect(runtimeIndex).toBeGreaterThan(resolverIndex)
    expect(initializedIndex).toBeGreaterThan(runtimeIndex)
  })

  it('keeps main-window guards, core IPC, PTY, and auth consumers on the same globals', () => {
    const guardMessages = [
      'Rate limit service must be initialized before opening the main window',
      'Codex account service must be initialized before opening the main window',
      'Codex runtime home service must be initialized before opening the main window',
      'Claude account service must be initialized before opening the main window',
      'Claude runtime auth service must be initialized before opening the main window'
    ]

    for (const message of guardMessages) {
      expect(source).toContain(message)
    }
    const coreHandlersIndex = source.indexOf('registerCoreHandlers(')
    const coreCodexIndex = source.indexOf('codexAccounts,', coreHandlersIndex)
    const coreClaudeIndex = source.indexOf('claudeAccounts,', coreCodexIndex)
    const coreRateLimitsIndex = source.indexOf('rateLimits,', coreClaudeIndex)

    expect(coreHandlersIndex).toBeGreaterThanOrEqual(0)
    expect(coreCodexIndex).toBeGreaterThan(coreHandlersIndex)
    expect(coreClaudeIndex).toBeGreaterThan(coreCodexIndex)
    expect(coreRateLimitsIndex).toBeGreaterThan(coreClaudeIndex)
    expect(source).toContain('prepareForCodexLaunch: prepareCodexRuntimeHomeForLaunch')
    expect(source).toContain(
      'prepareForClaudeLaunch: (target) => claudeRuntimeAuth!.prepareForClaudeLaunch(target)'
    )
    expect(source).toContain(
      'await preserveAgentAuthBeforeRestart({ codexRuntimeHome, claudeRuntimeAuth, store })'
    )
    expect(source).toContain('rateLimits.attach(window)')
    expect(source).toContain('rateLimits.start({ fetchImmediately: false })')
  })

  it('keeps live usage, inactive accounts, serve preparation, and quit behavior in index', () => {
    const liveStatusIndex = source.indexOf('agentHookServer.setClaudeStatusLineListener(')
    const inactiveClaudeIndex = source.indexOf(
      'rateLimits.setInactiveClaudeAccountsResolver(',
      liveStatusIndex
    )
    const inactiveCodexIndex = source.indexOf(
      'rateLimits.setInactiveCodexAccountsResolver(',
      inactiveClaudeIndex
    )
    const serveIndex = source.indexOf('if (serveOptions) {', inactiveCodexIndex)
    const headlessPtyIndex = source.indexOf('registerHeadlessPtyRuntime(', serveIndex)
    const stopIndex = source.indexOf('rateLimits?.stop()')

    expect(liveStatusIndex).toBeGreaterThanOrEqual(0)
    expect(inactiveClaudeIndex).toBeGreaterThan(liveStatusIndex)
    expect(inactiveCodexIndex).toBeGreaterThan(inactiveClaudeIndex)
    expect(headlessPtyIndex).toBeGreaterThan(serveIndex)
    expect(stopIndex).toBeGreaterThan(headlessPtyIndex)
  })
})
