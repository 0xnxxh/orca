#!/usr/bin/env node

import { execFile } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveEmulatorOrcaCli } from './emulator-orca-cli-selection.mjs'
import { verifyHostedAndroidAgentHistoryJourney } from './hosted-android-agent-history-journey.mjs'
import {
  tapHostedAndroidAccessibilityControl,
  tapHostedAndroidPoint,
  waitForHostedAndroidAccessibilityControlMatch
} from './hosted-android-emulator-accessibility.mjs'
import {
  assertHostedAndroidBridgeLogClean,
  buildHostedAndroidDebugApp,
  forwardHostedAndroidInspector,
  installAndResetHostedAndroidApp,
  launchHostedAndroidDevClient,
  openHostedAndroidUrl,
  resolveHostedAndroidAdb,
  startHostedAndroidMetro,
  stopHostedAndroidApp
} from './hosted-android-emulator-session.mjs'
import { runAndroidAdb } from './hosted-android-mobile-web-cache.mjs'
import { HOSTED_MOBILE_APP_ROUTE_URL } from './hosted-mobile-e2e-launch.mjs'
import {
  activateHostedWebViewControl,
  readHostedWebViewState,
  readHostedWebViewTextPoint,
  verifyHostedWebViewNavigationIsolation,
  verifyHostedWebViewNetworkIsolation,
  waitForVisibleHostedWebView
} from './hosted-webview-cdp-session.mjs'
import { resolveHostedWebViewRuntimeDirectory } from './hosted-webview-runtime-directory.mjs'
import { activateHostedWorkspaceRow } from './hosted-webview-workspace-activation.mjs'
import { verifyHostedSourceControlReviewJourney } from './hosted-ios-source-control-review-journey.mjs'
import { startHostedWebViewSecurityProbe } from './hosted-ios-webview-security-probe.mjs'
import {
  registerWorktreeForPairingRuntime,
  startHeadlessPairingRuntime
} from './start-emulator-pairing-runtime.mjs'

const execFileAsync = promisify(execFile)
const worktree = path.resolve(import.meta.dirname, '../..')
const mobileDir = path.join(worktree, 'mobile')
const androidDir = path.join(mobileDir, 'android')
const defaultApk = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk')
const options = parseOptions(process.argv.slice(2))
const adb = resolveHostedAndroidAdb(options.adb)
const runtimeDirectory = resolveHostedWebViewRuntimeDirectory({
  worktree,
  override: process.env.ORCA_E2E_MOBILE_WEBVIEW_RUN_DIRECTORY
})
const orcaCli = resolveEmulatorOrcaCli({
  explicitCommand: process.env.ORCA_CLI,
  managedCommand: process.env.ORCA_CLI_COMMAND,
  devRepoRoot: process.env.ORCA_DEV_REPO_ROOT,
  worktree,
  cwd: worktree
}).command

async function main() {
  let runtime
  let metro
  let probe
  let inspector
  const reversePorts = new Set()
  try {
    await stage('Android emulator', () => runAndroidAdb(adb, ['get-state']))
    await stage('Android log reset', () => runAndroidAdb(adb, ['logcat', '-c']))
    if (!options.skipNativeBuild) {
      await stage('Android debug app build', () => buildHostedAndroidDebugApp({ adb, androidDir }))
    }
    probe = await stage('network isolation sentinel', startHostedWebViewSecurityProbe)
    runtime = await stage('temporary paired desktop runtime', () =>
      startHeadlessPairingRuntime({
        enabled: true,
        orcaCli,
        cwd: worktree,
        runDirectory: path.join(runtimeDirectory, 'paired-host'),
        lanIpCandidates: () => ['127.0.0.1'],
        logStep: () => {},
        logSuccess: () => {}
      })
    )
    runtime.env.ORCA_E2E_MOBILE_AGENT_HISTORY_FIXTURE = '1'
    await stage('test workspace registration', () =>
      registerWorktreeForPairingRuntime(runtime, worktree, {
        orca: runOrca,
        logStep: () => {},
        logSuccess: () => {}
      })
    )
    metro = await stage('Metro', () =>
      startHostedAndroidMetro({ mobileDir, pairingUrl: runtime.pairingUrl })
    )
    for (const port of [runtime.port, metro.port, probe.port]) {
      await runAndroidAdb(adb, ['reverse', `tcp:${port}`, `tcp:${port}`])
      reversePorts.add(port)
    }
    await stage('sentinel reachability red check', () => proveSentinelReachability(adb, probe))
    await stage('exact Android app install', () =>
      installAndResetHostedAndroidApp(adb, options.apk)
    )
    await stage('development client launch', () =>
      launchHostedAndroidDevClient(adb, metro.port, probe)
    )
    const emulator = { adb }
    await stage('native pairing', () =>
      pairAndroidApp(emulator, runtime.pairingUrl, options.timeoutMs)
    )
    await stage('native hybrid route handoff', async () => {
      await openHostedAndroidUrl(adb, HOSTED_MOBILE_APP_ROUTE_URL)
    })
    inspector = await stage('Android WebView inspector', () =>
      forwardHostedAndroidInspector(adb, options.timeoutMs)
    )
    const discoveryUrl = `http://127.0.0.1:${inspector.port}`
    await stage('hosted workspace route', () =>
      waitForVisibleHostedWebView({
        discoveryUrl,
        expectedText: 'Orca Desktop',
        timeoutMs: options.timeoutMs
      })
    )
    const expectedWorkspace = path.basename(worktree)
    const workspaceDocument = await stage('hosted workspace data', () =>
      waitForVisibleHostedWebView({
        discoveryUrl,
        expectedText: expectedWorkspace.toLocaleUpperCase(),
        timeoutMs: options.timeoutMs
      })
    )
    await stage('workspace activation', async () => {
      try {
        await activateHostedWorkspaceRow(
          workspaceDocument,
          expectedWorkspace,
          (document, target) => activateAndroidWorkspaceControl(emulator, document, target),
          Math.min(options.timeoutMs, 15_000),
          () =>
            waitForVisibleHostedWebView({
              discoveryUrl,
              expectedText: 'Orca Desktop',
              timeoutMs: options.timeoutMs
            })
        )
      } catch (error) {
        let diagnostics = 'unavailable'
        try {
          const currentDocument = await waitForVisibleHostedWebView({
            discoveryUrl,
            expectedText: 'Orca Desktop',
            timeoutMs: options.timeoutMs
          })
          const state = await readHostedWebViewState(currentDocument)
          diagnostics = `labels=${JSON.stringify(state.labels)} bodyText=${JSON.stringify(
            state.bodyText
          )}`
        } catch (diagnosticError) {
          diagnostics = `unavailable: ${
            diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
          }`
        }
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}. Diagnostics ${diagnostics}`
        )
      }
    })
    const sessionDocument = await stage('hosted Session route', () =>
      waitForVisibleHostedWebView({
        discoveryUrl,
        expectedText: '1 tab',
        expectedHrefIncludes: '/session/',
        requireInteractiveControls: false,
        timeoutMs: options.timeoutMs
      })
    )
    const agentHistoryResult = await stage('Agent History journey', () =>
      verifyHostedAndroidAgentHistoryJourney({
        discoveryUrl,
        emulator,
        sessionDocument,
        timeoutMs: options.timeoutMs
      })
    )
    const { returnedSessionDocument, ...agentHistory } = agentHistoryResult
    const sourceControlReview = await stage('Source Control and Review journey', () =>
      verifyHostedSourceControlReviewJourney({
        discoveryUrl,
        emulator,
        sessionDocument: returnedSessionDocument,
        expectedSessionDiffText: '3 tabs',
        timeoutMs: options.timeoutMs,
        tapPoint: tapHostedAndroidJourneyControl
      })
    )
    const reviewDocument = await waitForVisibleHostedWebView({
      discoveryUrl,
      expectedText: 'reviewed',
      expectedHrefIncludes: '/review/',
      timeoutMs: options.timeoutMs
    })
    const networkIsolation = await stage('network isolation probe', () =>
      verifyHostedWebViewNetworkIsolation({
        document: reviewDocument,
        probeId: probe.token
      })
    )
    const navigationIsolation = await stage('navigation isolation probe', () =>
      verifyHostedWebViewNavigationIsolation({
        document: reviewDocument,
        discoveryUrl,
        probeId: probe.token
      })
    )
    await delay(500)
    if (probe.observations.length > 0) {
      throw new Error(
        `Hosted Android WebView reached the sentinel: ${probe.observations.join(', ')}`
      )
    }
    await stage('Android bridge log audit', () => assertHostedAndroidBridgeLogClean(adb))
    console.log(
      JSON.stringify(
        {
          ok: true,
          device: await runAndroidAdb(adb, ['shell', 'getprop', 'ro.product.model']),
          pid: inspector.pid,
          workspace: expectedWorkspace,
          agentHistory,
          sourceControlReview,
          networkIsolation,
          navigationIsolation,
          sentinelObservations: probe.observations
        },
        null,
        2
      )
    )
  } finally {
    await stopHostedAndroidApp(adb)
    if (inspector) {
      await runAndroidAdb(adb, ['forward', '--remove', `tcp:${inspector.port}`]).catch(() => {})
    }
    for (const port of reversePorts) {
      await runAndroidAdb(adb, ['reverse', '--remove', `tcp:${port}`]).catch(() => {})
    }
    await metro?.stop()
    await runtime?.stop({ shutdownDaemon: true })
    await probe?.stop()
  }
}

async function pairAndroidApp(emulator, pairingUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await openHostedAndroidUrl(adb, pairingUrl)
    try {
      const control = await waitForHostedAndroidAccessibilityControlMatch(
        emulator,
        ['Close', 'Continue', 'Pair'],
        Math.min(5_000, deadline - Date.now())
      )
      if (control.label === 'Pair') {
        await tapHostedAndroidAccessibilityControl(emulator, control.label, 2_000)
        break
      }
      await tapHostedAndroidAccessibilityControl(emulator, control.label, 2_000)
    } catch {
      // The first deep link can arrive before the development bundle mounts.
    }
  }
  const destination = await waitForHostedAndroidAccessibilityControlMatch(
    emulator,
    [
      'Open sessions in Chat UI',
      'Open sessions in the terminal',
      'Enable agent notifications',
      'Skip notifications for now',
      'Show paired hosts',
      'Back to home'
    ],
    Math.max(1_000, deadline - Date.now())
  )
  if (destination.label === 'Back to home') {
    throw new Error('Android pairing failed before reaching the onboarding flow')
  }
}

async function activateAndroidWorkspaceControl(emulator, document, target) {
  if (target.kind !== 'text') {
    return activateHostedWebViewControl(document, target)
  }
  const point = await readHostedWebViewTextPoint(document, target.value, undefined, {
    ignoreCase: target.ignoreCase,
    occurrence: target.occurrence
  })
  await tapHostedAndroidPoint(emulator, point)
}

async function tapHostedAndroidJourneyControl(emulator, point, label) {
  if (label) {
    try {
      return await tapHostedAndroidAccessibilityControl(emulator, label, 5_000)
    } catch {
      // Chromium may omit a WebView descendant during an accessibility-tree refresh.
    }
  }
  return tapHostedAndroidPoint(emulator, point)
}

async function proveSentinelReachability(command, probe) {
  await runAndroidAdb(command, ['shell', 'nc', '-z', '-w', '5', '127.0.0.1', String(probe.port)])
  if (!probe.observations.includes('tcp:connection')) {
    throw new Error('Android loopback sentinel red check did not arrive')
  }
  probe.reset()
}

async function runOrca(args, runOptions) {
  const result = await execFileAsync(orcaCli, args, {
    cwd: runOptions.cwd,
    env: runOptions.env,
    encoding: 'utf8',
    timeout: runOptions.timeout
  })
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

async function stage(label, run) {
  process.stderr.write(`[android-e2e] ${label}...\n`)
  try {
    const result = await run()
    process.stderr.write(`[android-e2e] ${label}: ok\n`)
    return result
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    })
  }
}

function parseOptions(args) {
  const result = {
    adb: null,
    apk: defaultApk,
    skipNativeBuild: false,
    timeoutMs: 90_000
  }
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    if (option === '--') {
      continue
    } else if (option === '--adb') {
      result.adb = requireValue(args, ++index, option)
    } else if (option === '--apk') {
      result.apk = path.resolve(requireValue(args, ++index, option))
    } else if (option === '--skip-native-build') {
      result.skipNativeBuild = true
    } else if (option === '--timeout-ms') {
      result.timeoutMs = Number.parseInt(requireValue(args, ++index, option), 10)
    } else {
      throw new Error(`Unknown option: ${option}`)
    }
  }
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1_000) {
    throw new Error('--timeout-ms must be an integer of at least 1000')
  }
  return result
}

function requireValue(args, index, option) {
  if (!args[index]) {
    throw new Error(`${option} requires a value`)
  }
  return args[index]
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = 1
})
