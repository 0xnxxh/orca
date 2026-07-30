import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/telemetry-observability-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('telemetry/observability startup boundary', () => {
  it('removes every targeted eager index value import behind one owner', () => {
    for (const moduleSpecifier of [
      './observability',
      './telemetry/client',
      './telemetry/classify-error',
      './telemetry/cohort-classifier',
      './telemetry/onboarding-cohort-classifier',
      './telemetry/consent'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./startup/telemetry-observability-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)).toBeUndefined()
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after Codex and before Store or any live telemetry consumer', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const codexInstallIndex = source.indexOf(
      'installCodexLaunchSessionStartupCapability(codexLaunchSession)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, codexInstallIndex)
    const factoryIndex = source.indexOf(
      'const telemetryObservability = createTelemetryObservabilityStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installTelemetryObservabilityStartupCapability(telemetryObservability)',
      factoryIndex
    )
    const storeIndex = source.indexOf('store = createStoreStartupCapability(', installIndex)
    const initIndex = source.indexOf('telemetryObservability.initTelemetry(store)', storeIndex)

    expect(importIndex).toBeGreaterThan(codexInstallIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(storeIndex).toBeGreaterThan(installIndex)
    expect(initIndex).toBeGreaterThan(storeIndex)
  })

  it('keeps predeclared daemon and window callbacks fail closed', () => {
    const terminalStart = source.indexOf('function startTerminalRuntimeStartupServices():')
    const terminalEnd = source.indexOf('\nfunction prepareCodexRuntimeHomeForLaunch', terminalStart)
    const windowStart = source.indexOf('function openMainWindow(): BrowserWindow')
    const windowEnd = source.indexOf('\nfunction sendOpenFeatureTour', windowStart)

    expect(source.slice(terminalStart, terminalEnd)).toContain(
      'getTelemetryObservabilityStartupCapability()'
    )
    expect(source.slice(terminalStart, terminalEnd)).toContain(
      "track('daemon_start_failed', classifyError(error))"
    )
    expect(source.slice(windowStart, windowEnd)).toContain(
      'getTelemetryObservabilityStartupCapability()'
    )
    expect(source.slice(windowStart, windowEnd)).toContain(
      'const consent = resolveConsent(store.getSettings())'
    )
    expect(source.slice(windowStart, windowEnd)).toContain('trackAppOpenedOnce()')
  })

  it('preserves initialization, injection, cohort, and observability ordering', () => {
    const telemetryIndex = source.indexOf('telemetryObservability.initTelemetry(store)')
    const hangIndex = source.indexOf(
      "telemetryObservability.track('main_thread_hang_detected'",
      telemetryIndex
    )
    const trustInjectionIndex = source.indexOf(
      'codexLaunchSession.setCodexTrustGrantTelemetry(',
      hangIndex
    )
    const trustTrackIndex = source.indexOf(
      "telemetryObservability.track('codex_trust_grant'",
      trustInjectionIndex
    )
    const observabilityIndex = source.indexOf(
      'telemetryObservability.initObservability()',
      trustTrackIndex
    )
    const breadcrumbIndex = source.indexOf(
      "recordDurableCrashBreadcrumb('main_process_lifecycle_started'",
      observabilityIndex
    )
    const cohortIndex = source.indexOf(
      'telemetryObservability.initCohortClassifier(store)',
      breadcrumbIndex
    )
    const onboardingIndex = source.indexOf(
      'telemetryObservability.initOnboardingCohortClassifier(store)',
      cohortIndex
    )

    expect(hangIndex).toBeGreaterThan(telemetryIndex)
    expect(trustInjectionIndex).toBeGreaterThan(hangIndex)
    expect(trustTrackIndex).toBeGreaterThan(trustInjectionIndex)
    expect(observabilityIndex).toBeGreaterThan(trustTrackIndex)
    expect(breadcrumbIndex).toBeGreaterThan(observabilityIndex)
    expect(cohortIndex).toBeGreaterThan(breadcrumbIndex)
    expect(onboardingIndex).toBeGreaterThan(cohortIndex)
  })

  it('uses the optional owner only for pre-ready-safe shutdown in original order', () => {
    const quitIndex = source.indexOf("app.on('will-quit', (e) => {")
    const quitBlock = source.slice(quitIndex)
    const optionalIndex = quitBlock.indexOf(
      'getTelemetryObservabilityStartupCapabilityIfInstalled()'
    )
    const telemetryShutdownIndex = quitBlock.indexOf('telemetryObservability?.shutdownTelemetry()')
    const observabilityShutdownIndex = quitBlock.indexOf(
      'telemetryObservability?.shutdownObservability()'
    )
    const quitAgainIndex = quitBlock.indexOf('app.quit()', observabilityShutdownIndex)

    expect(optionalIndex).toBeGreaterThanOrEqual(0)
    expect(telemetryShutdownIndex).toBeGreaterThan(optionalIndex)
    expect(observabilityShutdownIndex).toBeGreaterThan(telemetryShutdownIndex)
    expect(quitAgainIndex).toBeGreaterThan(observabilityShutdownIndex)
  })
})
