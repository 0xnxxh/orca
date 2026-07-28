import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { dismissEmulatorDeveloperMenuIfPresent } from './emulator-developer-menu-dismissal.mjs'
import {
  tapHostedIosAccessibilityControl,
  tapHostedIosAccessibilityControlByLabelPrefix,
  tapHostedIosPoint,
  waitForHostedIosAccessibilityControl,
  waitForHostedIosAccessibilityControlByLabelPrefix,
  waitForHostedIosAccessibilityControlMatch
} from './hosted-ios-emulator-accessibility.mjs'
import { assertHostedIosScreenshotParity } from './hosted-ios-screenshot-parity.mjs'
import {
  activateHostedWebViewControl,
  readHostedWebViewTextPoint,
  waitForVisibleHostedWebView
} from './hosted-webview-cdp-session.mjs'
import { readHostedWebViewControlPoint } from './hosted-webview-control-point.mjs'
import { activateHostedWorkspaceRow } from './hosted-webview-workspace-activation.mjs'

const execFileAsync = promisify(execFile)
const TASKS_TOOLBAR_X = 0.87
const TASK_STABLE_TEXTS = [
  'Connect your Linear account',
  'No Linear tasks',
  'No GitHub tasks',
  'No GitLab tasks',
  'No matching tasks',
  'Choose a GitHub project',
  'Update Orca desktop'
]

export async function captureNativeCoreRouteBaselines({
  deviceUdid,
  emulator,
  expectedWorkspace,
  runtimeDirectory,
  timeoutMs
}) {
  await dismissEmulatorDeveloperMenuIfPresent(emulator)
  const filterPoint = await waitForHostedIosAccessibilityControl(emulator, 'Filter', timeoutMs)
  // The existing non-embedded Tasks icon has no native accessibility label.
  await tapHostedIosPoint(emulator, { x: TASKS_TOOLBAR_X, y: filterPoint.y })
  const taskStableState = await waitForHostedIosAccessibilityControlMatch(
    emulator,
    TASK_STABLE_TEXTS,
    timeoutMs
  )
  const tasks = await captureNativeRoute({
    deviceUdid,
    emulator,
    runtimeDirectory,
    screenshotName: 'native-tasks-portrait.png',
    title: 'Tasks',
    timeoutMs
  })
  tasks.stableText = taskStableState.label
  await tapHostedIosPoint(emulator, tasksBackPoint(tasks.screenTitlePoint))
  await waitForHostedIosAccessibilityControlByLabelPrefix(emulator, expectedWorkspace, timeoutMs)
  await tapHostedIosAccessibilityControlByLabelPrefix(emulator, expectedWorkspace, timeoutMs)
  await waitForHostedIosAccessibilityControlByLabelPrefix(emulator, 'Mobile Emulator', timeoutMs)
  const session = await captureNativeRoute({
    deviceUdid,
    emulator,
    runtimeDirectory,
    screenshotName: 'native-session-portrait.png',
    title: expectedWorkspace,
    timeoutMs
  })
  await tapHostedIosAccessibilityControl(emulator, 'Back to worktrees', timeoutMs)
  await waitForHostedIosAccessibilityControlByLabelPrefix(emulator, expectedWorkspace, timeoutMs)
  return { session, tasks }
}

export async function captureHostedCoreRouteParity({
  deviceUdid,
  discoveryUrl,
  emulator,
  expectedWorkspace,
  nativeBaselines,
  runtimeDirectory,
  timeoutMs,
  workspaceDocument
}) {
  const tasksDocument = await openHostedTasks({
    discoveryUrl,
    emulator,
    stableText: nativeBaselines.tasks.stableText,
    timeoutMs,
    workspaceDocument
  })
  const tasks = await captureHostedRoute({
    deviceUdid,
    document: tasksDocument,
    nativeBaseline: nativeBaselines.tasks,
    runtimeDirectory,
    screenshotName: 'hosted-tasks-portrait.png',
    title: 'Tasks'
  })
  await tapHostedIosPoint(emulator, tasksBackPoint(tasks.screenTitlePoint))
  let activeWorkspaceDocument = await waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText: 'Orca Desktop',
    timeoutMs
  })
  await activateHostedWorkspaceRow(
    activeWorkspaceDocument,
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
  const session = await captureHostedRoute({
    deviceUdid,
    document: sessionDocument,
    nativeBaseline: nativeBaselines.session,
    runtimeDirectory,
    screenshotName: 'hosted-session-portrait.png',
    title: expectedWorkspace
  })
  await tapHostedSessionBack(emulator, sessionDocument, timeoutMs)
  activeWorkspaceDocument = await waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText: 'Orca Desktop',
    timeoutMs
  })
  return {
    evidence: {
      session: coreRouteParityEvidence(nativeBaselines.session, session),
      tasks: coreRouteParityEvidence(nativeBaselines.tasks, tasks)
    },
    workspaceDocument: activeWorkspaceDocument
  }
}

export function coreRouteParityEvidence(nativeCapture, hostedCapture) {
  return {
    nativeScreenshot: path.basename(nativeCapture.screenshot),
    hostedScreenshot: path.basename(hostedCapture.screenshot),
    nativeScreenTitlePoint: nativeCapture.screenTitlePoint,
    hostedScreenTitlePoint: hostedCapture.screenTitlePoint,
    screenshotParity: hostedCapture.screenshotParity
  }
}

async function openHostedTasks({
  discoveryUrl,
  emulator,
  stableText,
  timeoutMs,
  workspaceDocument
}) {
  const filterPoint = await readHostedWebViewTextPoint(workspaceDocument, 'Filter')
  await tapHostedIosPoint(emulator, { x: TASKS_TOOLBAR_X, y: filterPoint.y })
  return waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText: stableText,
    expectedHrefIncludes: '/tasks',
    timeoutMs
  })
}

async function captureNativeRoute({
  deviceUdid,
  emulator,
  runtimeDirectory,
  screenshotName,
  title,
  timeoutMs
}) {
  const screenTitlePoint = await waitForHostedIosAccessibilityControl(emulator, title, timeoutMs)
  await delay(500)
  const screenshot = path.join(runtimeDirectory, screenshotName)
  await captureSimulatorScreenshot(deviceUdid, screenshot)
  return { screenTitlePoint, screenshot }
}

async function captureHostedRoute({
  deviceUdid,
  document,
  nativeBaseline,
  runtimeDirectory,
  screenshotName,
  title
}) {
  const screenTitlePoint = await readHostedWebViewTextPoint(document, title)
  await delay(500)
  const screenshot = path.join(runtimeDirectory, screenshotName)
  await captureSimulatorScreenshot(deviceUdid, screenshot)
  const capture = { screenTitlePoint, screenshot }
  capture.screenshotParity = await assertHostedIosScreenshotParity({
    hostedLandmark: capture.screenTitlePoint,
    hostedScreenshot: capture.screenshot,
    nativeLandmark: nativeBaseline.screenTitlePoint,
    nativeScreenshot: nativeBaseline.screenshot
  })
  return capture
}

function tasksBackPoint(titlePoint) {
  return { x: Math.max(0.04, titlePoint.x - 0.12), y: titlePoint.y }
}

async function tapHostedSessionBack(emulator, document, timeoutMs) {
  try {
    await tapHostedIosAccessibilityControl(
      emulator,
      'Back to worktrees',
      Math.min(timeoutMs, 5_000)
    )
  } catch {
    const backPoint = await readHostedWebViewControlPoint(document, 'Back to worktrees')
    await tapHostedIosPoint(emulator, backPoint)
  }
}

async function captureSimulatorScreenshot(deviceUdid, outputPath) {
  await execFileAsync('xcrun', ['simctl', 'io', deviceUdid, 'screenshot', outputPath])
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
