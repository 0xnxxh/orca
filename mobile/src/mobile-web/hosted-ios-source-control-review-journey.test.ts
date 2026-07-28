import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigateRoute: vi.fn(),
  readControlPoint: vi.fn(),
  readState: vi.fn(),
  tapPoint: vi.fn(),
  waitForDocument: vi.fn()
}))

vi.mock('../../scripts/hosted-webview-cdp-session.mjs', () => ({
  readHostedWebViewState: mocks.readState,
  waitForVisibleHostedWebView: mocks.waitForDocument
}))

vi.mock('../../scripts/hosted-webview-control-point.mjs', () => ({
  readHostedWebViewControlPoint: mocks.readControlPoint
}))

vi.mock('../../scripts/hosted-ios-emulator-accessibility.mjs', () => ({
  tapHostedIosPoint: mocks.tapPoint
}))

vi.mock('../../scripts/hosted-webview-route-navigation.mjs', () => ({
  navigateHostedWebViewRoute: mocks.navigateRoute
}))

import { verifyHostedSourceControlReviewJourney } from '../../scripts/hosted-ios-source-control-review-journey.mjs'

describe('hosted iOS Source Control and Review journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readControlPoint
      .mockResolvedValueOnce({ x: 0.4, y: 0.2 })
      .mockResolvedValueOnce({ x: 0.5, y: 0.4 })
    mocks.navigateRoute.mockResolvedValue(undefined)
    mocks.tapPoint.mockResolvedValue(undefined)
    mocks.waitForDocument
      .mockResolvedValueOnce({
        href: 'orca-mobile-web://build/h/host/source-control/workspace?name=repo&origin=session'
      })
      .mockResolvedValueOnce({
        href: 'orca-mobile-web://build/h/host/session/workspace?name=repo'
      })
      .mockResolvedValueOnce({
        href: 'orca-mobile-web://build/h/host/review/workspace'
      })
    mocks.readState
      .mockResolvedValueOnce({
        href: 'orca-mobile-web://build/h/host/source-control/workspace?name=repo&origin=session',
        bodyText: 'Source Control Changes Pull Request Commits',
        labels: ['Refresh source control', 'Open changed file mobile/app/index.tsx']
      })
      .mockResolvedValueOnce({
        href: 'orca-mobile-web://build/h/host/review/workspace',
        bodyText: 'reviewed',
        labels: ['Back', 'Open review actions']
      })
  })

  it('opens the unchanged Session diff flow and standalone Review route', async () => {
    const emulator = { deviceUdid: 'simulator' }
    const sessionDocument = {
      href: 'orca-mobile-web://build/h/host/session/workspace'
    }

    await expect(
      verifyHostedSourceControlReviewJourney({
        discoveryUrl: 'http://127.0.0.1:9222',
        emulator,
        sessionDocument,
        timeoutMs: 30_000
      })
    ).resolves.toEqual({
      sourceControlRoute:
        'orca-mobile-web://build/h/host/source-control/workspace?name=repo&origin=session',
      sourceControlSegments: ['Changes', 'Pull Request', 'Commits'],
      sessionDiffRoute: 'orca-mobile-web://build/h/host/session/workspace?name=repo',
      reviewRoute: 'orca-mobile-web://build/h/host/review/workspace',
      reviewControls: ['Back', 'Open review actions']
    })

    expect(mocks.readControlPoint).toHaveBeenNthCalledWith(
      1,
      sessionDocument,
      'Open source control'
    )
    expect(mocks.tapPoint).toHaveBeenNthCalledWith(
      1,
      emulator,
      { x: 0.4, y: 0.2 },
      'Open source control'
    )
    expect(mocks.tapPoint).toHaveBeenNthCalledWith(
      2,
      emulator,
      { x: 0.5, y: 0.4 },
      'Open changed file mobile/app/index.tsx'
    )
    expect(mocks.navigateRoute).toHaveBeenCalledWith(
      { href: 'orca-mobile-web://build/h/host/session/workspace?name=repo' },
      '/h/host/review/workspace?scope=all&name=repo'
    )
  })

  it('accepts a platform-specific native tap implementation', async () => {
    const tapPoint = vi.fn().mockResolvedValue(undefined)

    await verifyHostedSourceControlReviewJourney({
      discoveryUrl: 'http://127.0.0.1:9222',
      emulator: { adb: '/sdk/adb' },
      sessionDocument: {
        href: 'orca-mobile-web://build/h/host/session/workspace'
      },
      expectedSessionDiffText: '3 tabs',
      timeoutMs: 30_000,
      tapPoint
    })

    expect(tapPoint).toHaveBeenCalledTimes(2)
    expect(tapPoint.mock.calls.map((call) => call[2])).toEqual([
      'Open source control',
      'Open changed file mobile/app/index.tsx'
    ])
    expect(mocks.waitForDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedText: '3 tabs' })
    )
  })
})
