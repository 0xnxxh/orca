import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('startup ordering', () => {
  it('passes the startup barrier into PTY handlers without blocking window creation', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachStart = source.indexOf('attachMainWindowServices(')
    const attachEnd = source.indexOf('rateLimits.attach(window)', attachStart)
    const attachBlock = source.slice(attachStart, attachEnd)
    // Why: anchor on the destructure head only — the settled-result variable's name is not the
    // contract, and pinning it turns a rename into a cryptic `expected -1` failure here.
    const desktopStart = source.indexOf('const [win')
    // Why: anchor on code, not a comment — the previous comment anchor was silently reworded, so
    // this was -1 and sliced to EOF, letting the assertions below pass against never-run code.
    const desktopEnd = source.indexOf("win.once('show'", desktopStart)
    const desktopStartup = source.slice(desktopStart, desktopEnd)

    // Why: bound every anchor, not just the desktop pair — an unresolved one slices to EOF.
    expect(attachStart).toBeGreaterThanOrEqual(0)
    expect(attachEnd).toBeGreaterThan(attachStart)
    expect(desktopStart).toBeGreaterThanOrEqual(0)
    expect(desktopEnd).toBeGreaterThan(desktopStart)

    expect(attachBlock).toContain('awaitLocalPtyStartup: () => localPtyStartupReady')
    expect(attachBlock).toContain(
      'awaitLocalPtyProviderStartup: () => localPtyProviderStartupReady'
    )
    expect(source).toContain(
      'firstWindowStartupServicesReady = services.then((value) => value.firstWindowReady)'
    )
    expect(source).toContain('localPtyStartupReady = services.then((value) => value.localPtyReady)')

    const windowIndex = desktopStartup.indexOf('Promise.resolve(desktopWindow ?? openMainWindow())')
    const rpcStartIndex = desktopStartup.indexOf('desktopRuntimeRpc.start()')
    const legacyRpcStartIndex = desktopStartup.indexOf('runtimeRpc.start()')

    expect(windowIndex).toBeGreaterThanOrEqual(0)
    expect(Math.max(rpcStartIndex, legacyRpcStartIndex)).toBeGreaterThanOrEqual(0)
    expect(desktopStartup).toMatch(
      /shellPathReady\s*\.then\(\(\) => (?:desktopRuntimeRpc|runtimeRpc)\.start\(\)\)/
    )
    expect(desktopStartup).toContain('recordRuntimeRpcStartFailure(')
    // Why: `void`, not `await` — awaiting the dialog would park the rest of startup behind a modal.
    expect(desktopStartup).toMatch(/void showRuntimeRpcStartupFailureDialog\(\s*win,/)
    // Why (#11025): a bare console.error here is exactly what left the CLI dead but the app healthy.
    expect(desktopStartup).not.toContain(
      "console.error('[runtime] Failed to start local RPC transport:'"
    )
  })

  // Why: app.disableHardwareAcceleration() is a no-op once whenReady resolves, and the marker/history
  // paths must agree on one userData path — app.setName() changes how a late getPath('userData') resolves.
  it('decides GPU fallback before whenReady and setName, off one canonical userData path', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const applyIndex = source.indexOf('  maybeApplyGpuFallbackForThisLaunch()')
    const whenReadyIndex = source.indexOf('void app.whenReady().then(')
    const setNameIndex = source.indexOf('app.setName(devInstanceIdentity.appName)')
    const applyStart = source.indexOf('function maybeApplyGpuFallbackForThisLaunch()')
    const applyEnd = source.indexOf('function persistGpuFallbackMarker(', applyStart)
    const apply = source.slice(applyStart, applyEnd)

    expect(applyIndex).toBeGreaterThanOrEqual(0)
    expect(whenReadyIndex).toBeGreaterThan(applyIndex)
    expect(setNameIndex).toBeGreaterThan(applyIndex)
    expect(applyStart).toBeGreaterThanOrEqual(0)
    expect(applyEnd).toBeGreaterThan(applyStart)
    expect(apply).toContain('engageGpuFallbackForLaunch({')
    expect(apply).toContain('userDataPath: getCanonicalUserDataPath()')
    // Why: a modal here would block a process that has no window yet.
    expect(apply).not.toContain('promptForGpuFallbackRestart')

    // Why: the marker used to be read pre-setName and written post-setName, which resolve
    // to different directories on a case-sensitive filesystem.
    const persistStart = source.indexOf('function persistGpuFallbackMarker(')
    const persistEnd = source.indexOf('function recordGpuCrashLaunchEvidence(', persistStart)
    const persist = source.slice(persistStart, persistEnd)

    expect(persistStart).toBeGreaterThanOrEqual(0)
    expect(persistEnd).toBeGreaterThan(persistStart)
    expect(persist).toContain('const userDataPath = getCanonicalUserDataPath()')
    expect(persist).not.toContain("app.getPath('userData')")
  })

  // Why: the crash-at-startup shape kills the process ~600ms in, so evidence written after the
  // threshold check or after a prompt never survives the launch that produced it.
  it('persists GPU crash evidence before the in-session threshold check', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const handlerStart = source.indexOf('async function handleGpuChildCrash(')
    const handlerEnd = source.indexOf('function recordProcessGoneCrash(', handlerStart)
    const handler = source.slice(handlerStart, handlerEnd)
    const evidenceIndex = handler.indexOf('recordGpuCrashLaunchEvidence(msSinceLaunch)')
    const trackerIndex = handler.indexOf('gpuCrashFallbackTracker.recordGpuCrash(')
    const promptIndex = handler.indexOf('promptForGpuFallbackRestart(')

    expect(handlerStart).toBeGreaterThanOrEqual(0)
    expect(handlerEnd).toBeGreaterThan(handlerStart)
    expect(evidenceIndex).toBeGreaterThanOrEqual(0)
    expect(trackerIndex).toBeGreaterThan(evidenceIndex)
    expect(promptIndex).toBeGreaterThan(evidenceIndex)
    // Why: a GPU death precedes ready-to-show, so the flag has to be set before anything can
    // throw — and scoped to the startup window that governs recording and counting.
    expect(
      handler.indexOf(
        'gpuCrashedDuringStartupThisLaunch ||= msSinceLaunch <= GPU_CRASH_STARTUP_WINDOW_MS'
      )
    ).toBeLessThan(evidenceIndex)
    expect(source).toContain("window.once('ready-to-show'")
    expect(source).toContain('armGpuCrashHistoryReset()')

    const armStart = source.indexOf('function armGpuCrashHistoryReset()')
    const armEnd = source.indexOf('function cancelGpuCrashHistoryReset()', armStart)
    const arm = source.slice(armStart, armEnd)

    expect(armStart).toBeGreaterThanOrEqual(0)
    expect(armEnd).toBeGreaterThan(armStart)
    // Why: what the survival proves is resolved when the timer fires, not when it is armed —
    // a GPU death in between narrows the reset to this launch instead of vetoing it.
    expect(arm).toContain('applyGpuCrashHistoryReset()')
    expect(arm).toContain('resolveGpuCrashHistoryReset({')
    expect(arm).toContain('gpuCrashedDuringStartup: gpuCrashedDuringStartupThisLaunch')
    expect(arm).toContain('gpuFallbackActive: gpuFallbackActiveThisLaunch')
  })

  it('requires daemon authority before restored-subagent liveness runs', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const sweepStart = source.indexOf('function reapRestoredSubagentsWithoutLiveAgent()')
    const sweepEnd = source.indexOf('function startTerminalRuntimeStartupServices()', sweepStart)
    const sweep = source.slice(sweepStart, sweepEnd)

    expect(sweepStart).toBeGreaterThanOrEqual(0)
    expect(sweepEnd).toBeGreaterThan(sweepStart)
    expect(sweep).toContain('const provider = getDaemonProvider()')
    expect(sweep).toContain('if (!provider) {')
    expect(sweep).toContain('provider.probePtyLiveness(ptyId)')
  })

  it('bounds WSL reconciliation before serve RPC while leaving desktop startup independent', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const barrierStart = source.indexOf("ipcMain.handle('app:awaitFirstWindowStartupServices'")
    const barrierEnd = source.indexOf("'app:startupDiagnostic'", barrierStart)
    const barrier = source.slice(barrierStart, barrierEnd)
    const reconciliationStart = source.indexOf(
      'managedWslCliReconciliationReady = reconcileManagedWslCliRegistrations('
    )
    const serveStart = source.indexOf('if (serveOptions) {', reconciliationStart)
    const serveReady = source.indexOf('await printServeReady(serveOptions)', serveStart)
    const serveEnd = source.indexOf('return', serveReady)
    const desktopWindowStart = source.indexOf(
      'const desktopStartup = startWindowsDesktopBeforeShellPathReady('
    )
    const desktopWindowJoin = source.indexOf(
      'Promise.resolve(desktopWindow ?? openMainWindow())',
      serveEnd
    )
    const serveStartup = source.slice(serveStart, serveEnd)
    const desktopStartup = source.slice(reconciliationStart, serveStart)

    expect(barrierStart).toBeGreaterThanOrEqual(0)
    expect(barrierEnd).toBeGreaterThan(barrierStart)
    expect(reconciliationStart).toBeGreaterThanOrEqual(0)
    expect(serveStart).toBeGreaterThan(reconciliationStart)
    expect(serveEnd).toBeGreaterThan(serveStart)
    // Why: bound against serveEnd, not reconciliationStart — an earlier openMainWindow() call
    // would steal this anchor, collapse desktopStartup to '', and pass the negative check below.
    expect(desktopWindowStart).toBeGreaterThan(reconciliationStart)
    expect(desktopWindowStart).toBeLessThan(serveStart)
    expect(desktopWindowJoin).toBeGreaterThan(serveEnd)
    expect(serveStartup).toContain('await managedWslCliStartupBarrierReady')
    expect(serveStartup).not.toContain('await managedWslCliReconciliationReady')
    expect(serveStartup.indexOf('await managedWslCliStartupBarrierReady')).toBeLessThan(
      serveStartup.indexOf('await runtimeRpc.start()')
    )
    expect(desktopStartup).not.toContain('await managedWslCliReconciliationReady')
    expect(desktopStartup).toContain(
      "process.platform === 'win32' && app.isPackaged && !serveOptions"
    )
    expect(desktopStartup).toContain(
      'openWindow: () => openMainWindow({ revealOnDidFinishLoad: true })'
    )
    expect(desktopStartup).toContain('shellPathReady,')
    expect(desktopStartup).toContain('startServices: startTerminalRuntimeStartupServices')
    expect(barrier).toContain('managedWslCliStartupBarrierReady')
    expect(barrier).not.toContain('managedWslCliReconciliationReady')
    expect(barrier).toContain("ipcMain.handle('app:recoverLegacyWorkerTerminalsForRendererStartup'")
    expect(barrier).toContain('recoverLegacyWorkerTerminalsForRendererStartup({')
    expect(barrier).toContain('localPtyProviderStartupReady,')
    expect(barrier).toContain('await runtime?.refreshRestoredOrchestrationAuthority()')
    expect(barrier).toContain(
      'return runtime?.reconcileLegacyWorkerTerminals({ materializeRenderer: true })'
    )
  })

  it('reconciles retained Codex homes after authoritative daemon inventory', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const daemonInitIndex = source.indexOf('await initDaemonPtyProvider(signal')
    const retainedPaneGateIndex = source.indexOf(
      'hasRecordedManagedHostCodexPane()',
      daemonInitIndex
    )
    const inventoryIndex = source.indexOf('await listLiveDaemonPtyIds()', daemonInitIndex)
    const reconciliation = 'codexRuntimeHome?.reconcileLegacySharedHomeForRetainedPanes()'
    const reconciliationIndex = source.indexOf(reconciliation, inventoryIndex)
    const hookReconciliationIndex = source.indexOf(
      'reconcileRetainedCodexHookHomes({',
      inventoryIndex
    )
    const serveIndex = source.indexOf('if (serveOptions) {', reconciliationIndex)
    const desktopIndex = source.indexOf(
      'Promise.resolve(desktopWindow ?? openMainWindow())',
      serveIndex
    )

    expect(daemonInitIndex).toBeGreaterThanOrEqual(0)
    expect(retainedPaneGateIndex).toBeGreaterThan(daemonInitIndex)
    expect(inventoryIndex).toBeGreaterThan(daemonInitIndex)
    expect(inventoryIndex).toBeGreaterThan(retainedPaneGateIndex)
    expect(hookReconciliationIndex).toBeGreaterThan(inventoryIndex)
    expect(hookReconciliationIndex).toBeLessThan(reconciliationIndex)
    expect(reconciliationIndex).toBeGreaterThan(inventoryIndex)
    expect(serveIndex).toBeGreaterThan(reconciliationIndex)
    expect(desktopIndex).toBeGreaterThan(serveIndex)
    expect(source.split(reconciliation)).toHaveLength(2)
  })

  it('exposes managed WSL reconciliation status to headless serve clients and diagnostics', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')

    // Why: the barrier fails open, so the serve-ready payload must carry the
    // reconciliation state and the bounded wait must be traceable via a milestone.
    const readyStart = source.indexOf('await serveReadinessPublisher.publish(')
    const readyEnd = source.indexOf('pairing: pairing.available', readyStart)
    const readyPayload = source.slice(readyStart, readyEnd)

    // Why: unbounded, a renamed pairing key slices to EOF and the status only has to survive
    // somewhere later in the file — not in the serve-ready payload this test is about.
    expect(readyStart).toBeGreaterThanOrEqual(0)
    expect(readyEnd).toBeGreaterThan(readyStart)
    expect(readyPayload).toContain('managedWslCliReconciliation: managedWslCliReconciliationStatus')

    expect(source).toContain("managedWslCliReconciliationStatus = 'pending'")
    expect(source).toContain("managedWslCliReconciliationStatus = 'settled'")
    expect(source).toContain("managedWslCliReconciliationStatus = 'failed'")
    expect(source).toContain("logStartupMilestone('wsl-cli-barrier-resolved'")
  })

  it('notifies the serve supervisor only after publishing readiness', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const readyStart = source.indexOf('await serveReadinessPublisher.publish(')
    const supervisorReady = source.indexOf('notifyServeSupervisorReady(', readyStart)

    expect(readyStart).toBeGreaterThanOrEqual(0)
    expect(supervisorReady).toBeGreaterThan(readyStart)
  })

  it('does not run the rate-limit quota fetch before the first window can show results', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachIndex = source.indexOf('rateLimits.attach(window)')
    const startIndex = source.indexOf('rateLimits.start({ fetchImmediately: false })')

    expect(attachIndex).toBeGreaterThanOrEqual(0)
    expect(startIndex).toBeGreaterThan(attachIndex)
  })

  it('wires bounded teardown state to reporting but not recovery or close behavior', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const scopeStart = source.indexOf('function getExpectedTeardownScope(')
    const scopeEnd = source.indexOf('function markRecoveryReloadInFlight(', scopeStart)
    const scope = source.slice(scopeStart, scopeEnd)
    const windowStart = source.indexOf('const window = createMainWindow(store, {')
    const windowEnd = source.indexOf('onRendererRecoveryExhausted:', windowStart)
    const windowOptions = source.slice(windowStart, windowEnd)
    const recorderStart = source.indexOf('function recordProcessGoneCrash(')
    const recorderEnd = source.indexOf('function shutdownWatchersOnce(', recorderStart)
    const recorder = source.slice(recorderStart, recorderEnd)

    expect(scopeStart).toBeGreaterThanOrEqual(0)
    expect(scopeEnd).toBeGreaterThan(scopeStart)
    expect(scope).toContain('resolveExpectedTeardownScope({')
    expect(scope).toContain('includeSystemSessionEnd')
    expect(windowStart).toBeGreaterThanOrEqual(0)
    expect(windowEnd).toBeGreaterThan(windowStart)
    expect(windowOptions).toContain('getIsQuitting: () => isQuitting')
    expect(windowOptions).toContain(
      'expectedTeardown: getExpectedTeardownScope(webContentsId, false)'
    )
    expect(recorderStart).toBeGreaterThanOrEqual(0)
    expect(recorderEnd).toBeGreaterThan(recorderStart)
    expect(recorder).toContain('expectedTeardown: getExpectedTeardownScope(webContentsId)')
  })

  it('attaches renderer services before starting the TCC prompt watcher', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachIndex = source.indexOf('attachMainWindowServices(')
    const tccNoticeIndex = source.indexOf('initTccPromptNotice(window', attachIndex)
    const quitAbortStart = source.indexOf('onQuitAborted:')
    const quitAbortEnd = source.indexOf('onRendererProcessGone:', quitAbortStart)

    expect(attachIndex).toBeGreaterThanOrEqual(0)
    expect(tccNoticeIndex).toBeGreaterThan(attachIndex)
    expect(source.slice(tccNoticeIndex, tccNoticeIndex + 120)).toContain(
      'deferWatchUntilReadyToShow: true'
    )
    expect(source.slice(quitAbortStart, quitAbortEnd)).not.toContain('initTccPromptNotice')
    expect(source).toContain("process.once('exit', stopTccPromptNotice)")
    const willQuitStart = source.indexOf("app.on('will-quit'")
    const windowAllClosedStart = source.indexOf("app.on('window-all-closed'", willQuitStart)
    expect(source.slice(willQuitStart, windowAllClosedStart)).toContain('stopTccPromptNotice()')
    expect(source.slice(0, willQuitStart)).not.toContain('stopTccPromptNoticeForQuit')
  })

  it('keeps the power bridge through vetoable before-quit and disposes after commit', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const beforeQuitStart = source.indexOf("app.on('before-quit'")
    const willQuitStart = source.indexOf("app.on('will-quit'", beforeQuitStart)
    const windowAllClosedStart = source.indexOf("app.on('window-all-closed'", willQuitStart)
    const beforeQuit = source.slice(beforeQuitStart, willQuitStart)
    const willQuit = source.slice(willQuitStart, windowAllClosedStart)
    const commitIndex = willQuit.indexOf('quitTeardownStartGate.tryStart(e)')
    const disposeIndex = willQuit.indexOf('unsubscribeSystemResumeBroadcast?.()')

    expect(beforeQuitStart).toBeGreaterThanOrEqual(0)
    expect(willQuitStart).toBeGreaterThan(beforeQuitStart)
    expect(windowAllClosedStart).toBeGreaterThan(willQuitStart)
    expect(beforeQuit).not.toContain('unsubscribeSystemResumeBroadcast')
    expect(commitIndex).toBeGreaterThanOrEqual(0)
    expect(disposeIndex).toBeGreaterThan(commitIndex)
  })

  it('starts the automation scheduler before headless serve reports ready', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const serveStart = source.indexOf('if (serveOptions) {')
    const serveReady = source.indexOf('await printServeReady(serveOptions)', serveStart)
    const serveReturn = source.indexOf('return', serveReady)
    const runtimeRpcStart = source.indexOf('await runtimeRpc.start()', serveStart)
    const automationStart = source.indexOf('automations.start()', serveStart)
    const desktopSetWebContents = source.indexOf('automations.setWebContents(window.webContents)')
    const desktopAutomationStart = source.indexOf('automations.start()', desktopSetWebContents + 1)

    expect(serveStart).toBeGreaterThanOrEqual(0)
    expect(serveReady).toBeGreaterThan(serveStart)
    expect(serveReturn).toBeGreaterThan(serveReady)
    expect(runtimeRpcStart).toBeGreaterThan(serveStart)
    expect(automationStart).toBeGreaterThan(runtimeRpcStart)
    expect(automationStart).toBeLessThan(serveReady)
    expect(automationStart).toBeLessThan(serveReturn)
    expect(desktopSetWebContents).toBeGreaterThanOrEqual(0)
    expect(desktopAutomationStart).toBeGreaterThan(desktopSetWebContents)
  })
})
