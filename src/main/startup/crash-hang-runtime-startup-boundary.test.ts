import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
const sourceFile = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false)
const capabilityModule = './startup/crash-hang-runtime-startup-capability'
const capabilityImport = `await import('${capabilityModule}')`

function findImport(moduleSpecifier: string): ts.ImportDeclaration | undefined {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (declaration) => (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
    )
}

describe('crash/hang runtime startup boundary', () => {
  it('keeps only the proven pre-ready breadcrumb and lifecycle leaves eager', () => {
    expect(findImport('./crash-reporting/crash-breadcrumb-store')).toBeDefined()
    expect(findImport('./crash-reporting/main-process-lifecycle-identity')).toBeDefined()
    for (const moduleSpecifier of [
      './crash-reporting/durable-crash-breadcrumb',
      './crash-reporting/crash-report-store',
      './crash-reporting/process-gone-classification',
      './crash-reporting/process-gone-recorder',
      './hang-watchdog/hang-detection-marker',
      './hang-watchdog/main-thread-hang-watchdog'
    ]) {
      expect(findImport(moduleSpecifier)).toBeUndefined()
    }

    expect(findImport('./startup/crash-hang-runtime-startup-owner')).toBeDefined()
    expect(findImport(capabilityModule)?.importClause?.isTypeOnly).toBe(true)
    expect(source.split(capabilityImport)).toHaveLength(2)
  })

  it('installs after telemetry and before store, watchdog, marker, and certificate consumers', () => {
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const telemetryInstallIndex = source.indexOf(
      'installTelemetryObservabilityStartupCapability(telemetryObservability)',
      readyIndex
    )
    const importIndex = source.indexOf(capabilityImport, telemetryInstallIndex)
    const factoryIndex = source.indexOf(
      'const crashHangRuntime = createCrashHangRuntimeStartupCapability()',
      importIndex
    )
    const installIndex = source.indexOf(
      'installCrashHangRuntimeStartupCapability(crashHangRuntime)',
      factoryIndex
    )
    const storeIndex = source.indexOf(
      'crashReports = crashHangRuntime.CrashReportStore.fromUserData()',
      installIndex
    )
    const watchdogIndex = source.indexOf(
      'crashHangRuntime.installMainThreadHangWatchdog({',
      storeIndex
    )
    const markerIndex = source.indexOf(
      'crashHangRuntime.consumeHangDetectionMarker(',
      watchdogIndex
    )
    const certificateIndex = source.indexOf("'certificate-error'", markerIndex)
    const appNameIndex = source.indexOf(
      'app.setName(devInstanceIdentity.appName)',
      certificateIndex
    )

    expect(importIndex).toBeGreaterThan(telemetryInstallIndex)
    expect(factoryIndex).toBeGreaterThan(importIndex)
    expect(installIndex).toBeGreaterThan(factoryIndex)
    expect(storeIndex).toBeGreaterThan(installIndex)
    expect(watchdogIndex).toBeGreaterThan(storeIndex)
    expect(markerIndex).toBeGreaterThan(watchdogIndex)
    expect(certificateIndex).toBeGreaterThan(markerIndex)
    expect(appNameIndex).toBeGreaterThan(certificateIndex)
  })

  it('preserves pre-ready breadcrumbs and defers the report store without moving GPU policy', () => {
    const bootstrapStart = source.indexOf('if (hasSingleInstanceLock) {')
    const readyIndex = source.indexOf('void app.whenReady().then(async () => {')
    const bootstrap = source.slice(bootstrapStart, readyIndex)

    expect(bootstrap).toContain("recordCrashBreadcrumb('app_started', {")
    expect(bootstrap).toContain('...getMainProcessLifecycleIdentity()')
    expect(bootstrap).toContain('maybeApplyGpuFallbackForThisLaunch()')
    expect(bootstrap).not.toContain('CrashReportStore.fromUserData')
    expect(source).toContain("recordCrashBreadcrumb('gpu_fallback_applied', {")
    expect(findImport('./crash-reporting/gpu-crash-fallback-decision')).toBeDefined()
    expect(findImport('./crash-reporting/gpu-fallback-restart-prompt')).toBeDefined()
  })

  it('routes every post-ready live callback through the exact installed owner', () => {
    const agentBreadcrumbStart = source.indexOf('function recordAgentStateCrashBreadcrumb(')
    const bootstrapStart = source.indexOf('if (hasSingleInstanceLock) {', agentBreadcrumbStart)
    const agentBreadcrumbBlock = source.slice(agentBreadcrumbStart, bootstrapStart)
    const windowStart = source.indexOf('function openMainWindow(): BrowserWindow')
    const windowEnd = source.indexOf('\nfunction sendOpenFeatureTour', windowStart)
    const windowBlock = source.slice(windowStart, windowEnd)
    const processGoneStart = source.indexOf('function recordProcessGoneCrash(')
    const processGoneEnd = source.indexOf('\nfunction shutdownWatchersOnce', processGoneStart)
    const processGoneBlock = source.slice(processGoneStart, processGoneEnd)

    expect(agentBreadcrumbBlock).toContain(
      'getCrashHangRuntimeStartupCapability().recordCoalescedCrashBreadcrumb({'
    )
    expect(windowBlock).toContain('const crashHangRuntime = getCrashHangRuntimeStartupCapability()')
    expect(windowBlock).toContain('crashHangRuntime.shouldRecoverRendererAfterProcessGone({')
    expect(windowBlock).toContain('crashHangRuntime.recordDurableCrashBreadcrumb(')
    expect(processGoneBlock).toContain(
      'getCrashHangRuntimeStartupCapability().recordProcessGoneCrash(crashReports, {'
    )
  })
})
