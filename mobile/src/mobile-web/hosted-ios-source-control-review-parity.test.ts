import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureScreenshot: vi.fn(),
  compareScreenshots: vi.fn(),
  dismissDeveloperMenu: vi.fn(),
  longPressControlByPrefix: vi.fn(),
  readTextPoint: vi.fn(),
  tapControl: vi.fn(),
  tapControlStartingWith: vi.fn(),
  waitForControl: vi.fn(),
  waitForControlByPrefix: vi.fn(),
  waitForControlEndingWith: vi.fn(),
  waitForControlStartingWith: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.captureScreenshot
}))
vi.mock('../../scripts/emulator-developer-menu-dismissal.mjs', () => ({
  dismissEmulatorDeveloperMenuIfPresent: mocks.dismissDeveloperMenu
}))
vi.mock('../../scripts/hosted-ios-emulator-accessibility.mjs', () => ({
  tapHostedIosAccessibilityControl: mocks.tapControl,
  tapHostedIosAccessibilityControlStartingWith: mocks.tapControlStartingWith,
  waitForHostedIosAccessibilityControl: mocks.waitForControl,
  waitForHostedIosAccessibilityControlByLabelPrefix: mocks.waitForControlByPrefix,
  waitForHostedIosAccessibilityControlEndingWith: mocks.waitForControlEndingWith,
  waitForHostedIosAccessibilityControlStartingWith: mocks.waitForControlStartingWith
}))
vi.mock('../../scripts/hosted-ios-emulator-long-press.mjs', () => ({
  longPressHostedIosAccessibilityControlByLabelPrefix: mocks.longPressControlByPrefix
}))
vi.mock('../../scripts/hosted-ios-screenshot-parity.mjs', () => ({
  assertHostedIosScreenshotParity: mocks.compareScreenshots
}))
vi.mock('../../scripts/hosted-webview-cdp-session.mjs', () => ({
  readHostedWebViewTextPoint: mocks.readTextPoint
}))

import {
  captureHostedSourceControlReviewScreen,
  captureNativeSourceControlReviewBaselines
} from '../../scripts/hosted-ios-source-control-review-parity.mjs'

describe('hosted iOS Source Control and Review parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.captureScreenshot.mockImplementation((_command, _args, callback) =>
      callback(null, '', '')
    )
    mocks.compareScreenshots.mockResolvedValue({ changedPixelRatio: 0.01 })
    mocks.longPressControlByPrefix.mockResolvedValue({ x: 0.5, y: 0.4 })
    mocks.readTextPoint.mockResolvedValue({ x: 0.2, y: 0.1 })
    mocks.tapControl.mockResolvedValue({ x: 0.2, y: 0.1 })
    mocks.tapControlStartingWith.mockResolvedValue({ x: 0.5, y: 0.5 })
    mocks.waitForControl.mockResolvedValue({ x: 0.2, y: 0.1 })
    mocks.waitForControlByPrefix.mockResolvedValue({ x: 0.5, y: 0.4 })
    mocks.waitForControlEndingWith.mockResolvedValue({ x: 0.5, y: 0.4 })
    mocks.waitForControlStartingWith.mockResolvedValue({ x: 0.5, y: 0.5 })
  })

  it('captures the real host-origin Source Control and standalone Review path', async () => {
    const baselines = await captureNativeSourceControlReviewBaselines({
      deviceUdid: 'simulator',
      emulator: { deviceUdid: 'simulator' },
      expectedWorkspace: 'mobile-rearch',
      runtimeDirectory: '/tmp/parity',
      timeoutMs: 30_000
    })

    expect(mocks.longPressControlByPrefix).toHaveBeenCalledWith(
      { deviceUdid: 'simulator' },
      'mobile-rearch',
      30_000
    )
    expect(mocks.tapControl).toHaveBeenCalledWith(
      { deviceUdid: 'simulator' },
      'Source Control',
      30_000
    )
    expect(mocks.tapControlStartingWith).toHaveBeenCalledWith(
      { deviceUdid: 'simulator' },
      'Open changed file ',
      30_000
    )
    expect(baselines).toEqual({
      review: {
        screenTitlePoint: { x: 0.2, y: 0.1 },
        screenshot: '/tmp/parity/native-review-portrait.png'
      },
      sourceControl: {
        screenTitlePoint: { x: 0.2, y: 0.1 },
        screenshot: '/tmp/parity/native-source-control-portrait.png'
      }
    })
  })

  it('compares a hosted route against its native screenshot and title landmark', async () => {
    const capture = await captureHostedSourceControlReviewScreen({
      deviceUdid: 'simulator',
      document: { href: 'orca-mobile-web://build/h/host/review/worktree' },
      nativeBaseline: {
        screenTitlePoint: { x: 0.2, y: 0.1 },
        screenshot: '/tmp/parity/native-review-portrait.png'
      },
      runtimeDirectory: '/tmp/parity',
      screenshotName: 'hosted-review-portrait.png',
      title: 'Changes',
      timeoutMs: 30_000
    })

    expect(capture.screenshotParity).toEqual({ changedPixelRatio: 0.01 })
    expect(mocks.compareScreenshots).toHaveBeenCalledWith({
      hostedLandmark: { x: 0.2, y: 0.1 },
      hostedScreenshot: '/tmp/parity/hosted-review-portrait.png',
      nativeLandmark: { x: 0.2, y: 0.1 },
      nativeScreenshot: '/tmp/parity/native-review-portrait.png'
    })
  })
})
