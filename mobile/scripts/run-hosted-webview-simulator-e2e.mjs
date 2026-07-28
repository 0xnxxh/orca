#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { startCdpServer } from 'inspect-webkit'
import { resolveEmulatorOrcaCli } from './emulator-orca-cli-selection.mjs'
import { parseHostedWebViewSimulatorE2eOptions } from './hosted-webview-simulator-e2e-options.mjs'
import {
  captureHostedAccountsParity,
  captureNativeAccountsBaseline
} from './hosted-ios-accounts-parity.mjs'
import { startHostedIosEmulatorController } from './hosted-ios-emulator-controller.mjs'
import {
  activateHostedWebViewControl,
  verifyHostedWebViewNavigationIsolation,
  verifyHostedWebViewNetworkIsolation,
  waitForVisibleHostedWebView
} from './hosted-webview-cdp-session.mjs'
import { captureNativeAgentHistoryBaseline } from './hosted-ios-agent-history-parity.mjs'
import {
  captureHostedCoreRouteParity,
  captureNativeCoreRouteBaselines
} from './hosted-ios-core-route-parity.mjs'
import {
  captureHostedFilesPreviewParity,
  captureNativeFilesPreviewBaselines
} from './hosted-ios-files-preview-parity.mjs'
import {
  captureHostedWorkspaceParity,
  captureNativeWorkspaceBaseline
} from './hosted-ios-workspace-parity.mjs'
import { verifyHostedAgentHistoryJourney } from './hosted-ios-agent-history-journey.mjs'
import { openHostedIosHybridRoute } from './hosted-ios-hybrid-route-handoff.mjs'
import { verifyHostedNativeTerminalSettingsHandoff } from './hosted-ios-native-settings-handoff.mjs'
import { verifyHostedSourceControlReviewJourney } from './hosted-ios-source-control-review-journey.mjs'
import { captureNativeSourceControlReviewBaselines } from './hosted-ios-source-control-review-parity.mjs'
import { completeHostedIosNativeOnboarding } from './hosted-ios-native-onboarding.mjs'
import { activateHostedWorkspaceRow } from './hosted-webview-workspace-activation.mjs'
import { resolveHostedWebViewRuntimeDirectory } from './hosted-webview-runtime-directory.mjs'
import {
  clearHostedIosWebViewSecurityProbe,
  configureHostedIosWebViewSecurityProbe,
  startHostedIosWebViewSecurityProbe
} from './hosted-ios-webview-security-probe.mjs'
import {
  buildAndInstallHostedIosSimulatorApp,
  hostedIosSimulatorAppPath,
  installHostedIosSimulatorApp
} from './hosted-ios-simulator-app-build.mjs'

const execFileAsync = promisify(execFile)
const worktree = path.resolve(import.meta.dirname, '../..')
const launcherPath = path.join(worktree, 'mobile', 'scripts', 'start-emulator.mjs')
const options = parseHostedWebViewSimulatorE2eOptions(process.argv.slice(2))
const runtimeDirectory = resolveHostedWebViewRuntimeDirectory({
  worktree,
  override: process.env.ORCA_E2E_MOBILE_WEBVIEW_RUN_DIRECTORY
})
const orcaSelection = resolveEmulatorOrcaCli({
  explicitCommand: process.env.ORCA_CLI,
  managedCommand: process.env.ORCA_CLI_COMMAND,
  devRepoRoot: process.env.ORCA_DEV_REPO_ROOT,
  worktree,
  cwd: worktree
})

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Hosted iOS WebView automation requires macOS and Xcode.')
  }
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 })
  const deviceUdid = await resolveSimulatorUdid(options.device)
  let launcher = null
  let inspector = null
  let networkProbe = null
  let emulatorController = null
  let nativeAppPath = null
  try {
    networkProbe = await startHostedIosWebViewSecurityProbe()
    await bootSimulator(deviceUdid)
    emulatorController = await startHostedIosEmulatorController({
      orcaCli: orcaSelection.command,
      runtimeDirectory,
      worktree
    })
    await configureHostedIosWebViewSecurityProbe(deviceUdid, networkProbe)
    nativeAppPath = options.skipNativeBuild
      ? await evidenceStep('cached native simulator app install', async () => {
          const appPath = hostedIosSimulatorAppPath(worktree)
          await installHostedIosSimulatorApp({ deviceUdid, appPath })
          return appPath
        })
      : await evidenceStep('native simulator app build', () =>
          buildAndInstallHostedIosSimulatorApp({
            deviceUdid,
            worktree
          })
        )
    launcher = startMobileLauncher(deviceUdid, emulatorController.userData)
    await waitForLauncher(launcher, options.timeoutMs)
    const emulator = {
      deviceUdid,
      orcaCli: orcaSelection.command,
      userDataDir: emulatorController.userData,
      worktree
    }
    const expectedWorkspace = path.basename(worktree)
    const nativeOnboarding = await evidenceStep('native onboarding', () =>
      completeHostedIosNativeOnboarding(emulator, expectedWorkspace, options.timeoutMs)
    )
    const nativeWorkspace =
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('native workspace baseline', () =>
            captureNativeWorkspaceBaseline({
              deviceUdid,
              emulator,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    const nativeAccounts =
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('native Accounts baseline', () =>
            captureNativeAccountsBaseline({
              deviceUdid,
              emulator,
              expectedWorkspace,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    const nativeCoreRoutes =
      options.accountsOnly ||
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('native Tasks and Session baselines', () =>
            captureNativeCoreRouteBaselines({
              deviceUdid,
              emulator,
              expectedWorkspace,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    const nativeFilesPreview =
      options.accountsOnly ||
      options.securityOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('native Files and Preview baselines', () =>
            captureNativeFilesPreviewBaselines({
              deviceUdid,
              emulator,
              expectedWorkspace,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    const nativeSourceControlReview =
      options.accountsOnly ||
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly
        ? null
        : await evidenceStep('native Source Control and Review baselines', () =>
            captureNativeSourceControlReviewBaselines({
              deviceUdid,
              emulator,
              expectedWorkspace,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    const nativeAgentHistory =
      options.accountsOnly ||
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('native Agent History baseline', () =>
            captureNativeAgentHistoryBaseline({
              deviceUdid,
              emulator,
              expectedWorkspace,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    await evidenceStep('native hybrid route handoff', () =>
      openHostedIosHybridRoute(emulator, options.timeoutMs)
    )
    const inspectorPort = await findAvailableLoopbackPort()
    inspector = await startCdpServer({ port: inspectorPort })
    let workspaceDocument = await waitForVisibleHostedWebView({
      discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
      expectedText: 'Orca Desktop',
      timeoutMs: options.timeoutMs
    })
    const hostedWorkspace =
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('hosted workspace parity', () =>
            captureHostedWorkspaceParity({
              deviceUdid,
              document: workspaceDocument,
              nativeBaseline: nativeWorkspace,
              runtimeDirectory,
              timeoutMs: options.timeoutMs
            })
          )
    const hostedAccounts =
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('hosted Accounts parity', () =>
            captureHostedAccountsParity({
              deviceUdid,
              discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
              emulator,
              nativeBaseline: nativeAccounts,
              runtimeDirectory,
              timeoutMs: options.timeoutMs,
              workspaceDocument
            })
          )
    workspaceDocument = hostedAccounts?.workspaceDocument ?? workspaceDocument
    const hostedCoreRoutes =
      options.accountsOnly ||
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('hosted Tasks and Session parity', () =>
            captureHostedCoreRouteParity({
              deviceUdid,
              discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
              emulator,
              expectedWorkspace,
              nativeBaselines: nativeCoreRoutes,
              runtimeDirectory,
              timeoutMs: options.timeoutMs,
              workspaceDocument
            })
          )
    const activeWorkspaceDocument = hostedCoreRoutes?.workspaceDocument ?? workspaceDocument
    const hostedFilesPreview =
      options.accountsOnly ||
      options.securityOnly ||
      options.nativeSettingsOnly ||
      options.sourceControlOnly
        ? null
        : await evidenceStep('hosted Files and Preview parity', () =>
            captureHostedFilesPreviewParity({
              deviceUdid,
              discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
              emulator,
              expectedWorkspace,
              nativeBaselines: nativeFilesPreview,
              runtimeDirectory,
              timeoutMs: options.timeoutMs,
              workspaceDocument: activeWorkspaceDocument
            })
          )
    const parityWorkspaceDocument = hostedFilesPreview?.workspaceDocument ?? activeWorkspaceDocument
    const historyEvidence =
      options.accountsOnly ||
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.sourceControlOnly
        ? null
        : options.nativeSettingsOnly
          ? await evidenceStep('native Terminal Settings journey', () =>
              verifyNativeSettingsJourney({
                discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
                emulator,
                workspaceDocument: parityWorkspaceDocument,
                expectedWorkspace,
                timeoutMs: options.timeoutMs
              })
            )
          : await evidenceStep('Agent History journey', () =>
              verifyHostedAgentHistoryJourney({
                discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
                launcher,
                emulator,
                nativeAgentHistory,
                runtimeDirectory,
                workspaceDocument: parityWorkspaceDocument,
                expectedWorkspace,
                timeoutMs: options.timeoutMs
              })
            )
    const sourceControlReview =
      options.accountsOnly ||
      options.securityOnly ||
      options.filesPreviewOnly ||
      options.nativeSettingsOnly
        ? null
        : await evidenceStep('Source Control and Review journey', async () => {
            if (options.sourceControlOnly) {
              await activateHostedWorkspaceRow(
                workspaceDocument,
                expectedWorkspace,
                activateHostedWebViewControl,
                options.timeoutMs,
                () =>
                  waitForVisibleHostedWebView({
                    discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
                    expectedText: 'Orca Desktop',
                    timeoutMs: options.timeoutMs
                  })
              )
            }
            const sessionDocument = await waitForVisibleHostedWebView({
              discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
              expectedText: options.sourceControlOnly ? '1 tab' : '2 tabs',
              expectedHrefIncludes: '/session/',
              requireInteractiveControls: false,
              timeoutMs: options.timeoutMs
            })
            return verifyHostedSourceControlReviewJourney({
              deviceUdid,
              discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
              emulator,
              expectedSessionDiffText: options.sourceControlOnly ? '2 tabs' : '3 tabs',
              nativeBaselines: nativeSourceControlReview,
              runtimeDirectory,
              sessionDocument,
              timeoutMs: options.timeoutMs
            })
          })
    const securityDocument =
      options.accountsOnly || options.securityOnly || options.filesPreviewOnly
        ? parityWorkspaceDocument
        : await waitForVisibleHostedWebView({
            discoveryUrl: `http://127.0.0.1:${inspectorPort}`,
            expectedText: options.nativeSettingsOnly ? 'Mobile Emulator' : 'reviewed',
            expectedHrefIncludes: options.nativeSettingsOnly ? '/session/' : '/review/',
            timeoutMs: options.timeoutMs
          })
    const networkIsolation = await evidenceStep('network isolation probe', () =>
      verifyHostedWebViewNetworkIsolation({
        document: securityDocument,
        probeId: networkProbe.token
      })
    )
    const navigationIsolation = await evidenceStep('navigation isolation probe', () =>
      verifyHostedWebViewNavigationIsolation({
        document: securityDocument,
        probeId: networkProbe.token
      })
    )
    await delay(500)
    if (networkProbe.observations.length > 0) {
      throw new Error(
        `Hosted WebView reached the network probe: ${networkProbe.observations.join(', ')}`
      )
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          device: deviceUdid,
          targetId: workspaceDocument.targetId,
          route: workspaceDocument.href,
          nativeAppPath,
          visibleText: expectedWorkspace,
          interactiveControls: workspaceDocument.buttonCount,
          networkIsolation,
          navigationIsolation,
          nativeOnboarding,
          workspaceParity: hostedWorkspace,
          accountsParity: hostedAccounts?.evidence ?? null,
          agentHistory: historyEvidence,
          coreRouteParity: hostedCoreRoutes?.evidence ?? null,
          filesPreviewParity: hostedFilesPreview?.evidence ?? null,
          sourceControlReview
        },
        null,
        2
      )
    )
  } finally {
    inspector?.stop()
    await stopProcess(launcher)
    await emulatorController?.stop()
    await clearHostedIosWebViewSecurityProbe(deviceUdid)
    await networkProbe?.stop()
  }
}

async function evidenceStep(label, run) {
  try {
    return await run()
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    })
  }
}

async function verifyNativeSettingsJourney({
  discoveryUrl,
  emulator,
  workspaceDocument,
  expectedWorkspace,
  timeoutMs
}) {
  await activateHostedWorkspaceRow(
    workspaceDocument,
    expectedWorkspace,
    activateHostedWebViewControl,
    timeoutMs,
    () =>
      waitForVisibleHostedWebView({
        discoveryUrl,
        expectedText: 'Orca Desktop',
        timeoutMs
      })
  )
  const sessionDocument = await waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText: 'Mobile Emulator',
    expectedHrefIncludes: '/session/',
    timeoutMs
  })
  return verifyHostedNativeTerminalSettingsHandoff({
    discoveryUrl,
    emulator,
    sessionDocument,
    timeoutMs,
    expectedSessionText: 'Mobile Emulator'
  })
}

async function resolveSimulatorUdid(requested) {
  const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])
  const devices = Object.values(JSON.parse(stdout).devices ?? {}).flat()
  const matches = devices.filter((device) => device.udid === requested || device.name === requested)
  const selected = matches.find((device) => device.state === 'Booted') ?? matches[0]
  if (!selected?.udid) {
    throw new Error(`No available iOS Simulator matched "${requested}".`)
  }
  return selected.udid
}

async function bootSimulator(deviceUdid) {
  const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])
  const devices = Object.values(JSON.parse(stdout).devices ?? {}).flat()
  const selected = devices.find((device) => device.udid === deviceUdid)
  if (selected?.state !== 'Booted') {
    await execFileAsync('xcrun', ['simctl', 'boot', deviceUdid])
  }
  await execFileAsync('xcrun', ['simctl', 'bootstatus', deviceUdid, '-b'])
}

function startMobileLauncher(deviceUdid, emulatorControlUserDataPath) {
  return spawn(
    process.execPath,
    [launcherPath, '--worktree', worktree, '--device', deviceUdid, '--wait-for-ready'],
    {
      cwd: worktree,
      env: {
        ...process.env,
        ORCA_CLI: orcaSelection.command,
        ORCA_E2E_MOBILE_AUTO_SELECT_PAIRED_HOST: '1',
        ORCA_E2E_MOBILE_AGENT_HISTORY_FIXTURE: '1',
        ORCA_E2E_MOBILE_RUN_DIRECTORY: path.join(runtimeDirectory, 'paired-host'),
        ORCA_E2E_MOBILE_RESTART_HOLD_MS: '2000',
        ORCA_E2E_MOBILE_EMULATOR_CONTROL_USER_DATA_PATH: emulatorControlUserDataPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
}

function waitForLauncher(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let outputTail = ''
    let settled = false
    const timer = setTimeout(() => {
      finish(new Error(`Mobile launcher timed out.\n${outputTail}`))
    }, timeoutMs)
    const consume = (chunk, target) => {
      const text = String(chunk)
      target.write(text)
      outputTail = (outputTail + text).slice(-32 * 1024)
      if (outputTail.includes('Setup complete!')) {
        finish()
      }
    }
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.off('exit', handleExit)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const handleExit = (code) => {
      finish(new Error(`Mobile launcher exited with code ${code}.\n${outputTail}`))
    }
    child.stdout.on('data', (chunk) => consume(chunk, process.stdout))
    child.stderr.on('data', (chunk) => consume(chunk, process.stderr))
    child.once('error', finish)
    child.once('exit', handleExit)
  })
}

function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No port'))
      )
    })
  })
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return
  }
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    })
  ])
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = 1
})
