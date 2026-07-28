import {
  readHostedWebViewState,
  waitForVisibleHostedWebView
} from './hosted-webview-cdp-session.mjs'
import { readHostedWebViewControlPoint } from './hosted-webview-control-point.mjs'
import {
  tapHostedIosAccessibilityControl,
  tapHostedIosPoint
} from './hosted-ios-emulator-accessibility.mjs'
import { navigateHostedWebViewRoute } from './hosted-webview-route-navigation.mjs'

export async function verifyHostedSourceControlReviewJourney({
  discoveryUrl,
  emulator,
  sessionDocument,
  timeoutMs,
  expectedSessionDiffText = '2 tabs',
  tapPoint = tapHostedJourneyPoint
}) {
  const sourceControl = await journeyStep('wait for Source Control route', () =>
    openSourceControlRoute({
      discoveryUrl,
      emulator,
      sessionDocument,
      timeoutMs,
      tapPoint
    })
  )
  const sourceState = await journeyStep('read populated Source Control state', () =>
    waitForChangedFileState(sourceControl, timeoutMs)
  )
  for (const label of ['Changes', 'Pull Request', 'Commits', 'Refresh source control']) {
    if (!sourceState.bodyText.includes(label) && !sourceState.labels.includes(label)) {
      throw new Error(`Source Control is missing ${label}.`)
    }
  }

  const changedFileLabel = sourceState.labels.find((label) =>
    label.startsWith('Open changed file ')
  )
  if (!changedFileLabel) {
    throw new Error('Source Control has no changed file available for Review.')
  }
  const sessionDiff = await journeyStep('wait for Session diff route', () =>
    openSessionDiffRoute({
      discoveryUrl,
      emulator,
      expectedText: expectedSessionDiffText,
      label: changedFileLabel,
      sourceControl,
      tapPoint,
      timeoutMs
    })
  )
  await journeyStep('open standalone Review route', () =>
    navigateHostedWebViewRoute(sessionDiff, standaloneReviewRoute(sourceState.href))
  )
  const review = await journeyStep('wait for Review route', () =>
    waitForVisibleHostedWebView({
      discoveryUrl,
      expectedText: 'reviewed',
      expectedHrefIncludes: '/review/',
      timeoutMs
    })
  )
  const reviewState = await journeyStep('read Review state', () => readHostedWebViewState(review))
  for (const label of ['Back', 'Open review actions']) {
    if (!reviewState.labels.includes(label)) {
      throw new Error(`Review is missing ${label}.`)
    }
  }

  return {
    sourceControlRoute: sourceState.href,
    sourceControlSegments: ['Changes', 'Pull Request', 'Commits'],
    sessionDiffRoute: sessionDiff.href,
    reviewRoute: reviewState.href,
    reviewControls: ['Back', 'Open review actions']
  }
}

async function tapHostedJourneyPoint(emulator, point, label, attempt = 0) {
  if (label && attempt === 0) {
    try {
      return await tapHostedIosAccessibilityControl(emulator, label, 5_000)
    } catch {
      // WebKit can omit a descendant while refreshing its accessibility tree.
    }
  }
  return tapHostedIosPoint(emulator, point)
}

async function openSourceControlRoute({
  discoveryUrl,
  emulator,
  sessionDocument,
  timeoutMs,
  tapPoint
}) {
  let lastError = new Error('Source Control route did not open')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const point = await readHostedWebViewControlPoint(sessionDocument, 'Open source control')
      await tapPoint(emulator, point, 'Open source control', attempt)
      return await waitForVisibleHostedWebView({
        discoveryUrl,
        expectedText: 'Source Control',
        expectedHrefIncludes: '/source-control/',
        timeoutMs: Math.min(timeoutMs, 3_000)
      })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function openSessionDiffRoute({
  discoveryUrl,
  emulator,
  expectedText,
  label,
  sourceControl,
  tapPoint,
  timeoutMs
}) {
  let lastError = new Error('Session diff route did not open')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const point = await readHostedWebViewControlPoint(sourceControl, label)
      await tapPoint(emulator, point, label, attempt)
    } catch (error) {
      lastError = error
      continue
    }
    try {
      return await waitForSessionDiff(discoveryUrl, expectedText, Math.min(timeoutMs, 3_000))
    } catch (error) {
      lastError = error
    }
    const transitioned = await waitForSessionDiff(discoveryUrl, '', 1_000).catch(() => null)
    if (transitioned) {
      return waitForSessionDiff(discoveryUrl, expectedText, timeoutMs)
    }
  }
  throw lastError
}

function waitForSessionDiff(discoveryUrl, expectedText, timeoutMs) {
  return waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText,
    expectedHrefIncludes: '/session/',
    requireInteractiveControls: false,
    timeoutMs
  })
}

async function waitForChangedFileState(document, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let state
  while (Date.now() < deadline) {
    state = await readHostedWebViewState(document)
    if (state.labels.some((label) => label.startsWith('Open changed file '))) {
      return state
    }
    await delay(250)
  }
  return state ?? readHostedWebViewState(document)
}

function standaloneReviewRoute(sourceControlHref) {
  const url = new URL(sourceControlHref)
  const pathname = url.pathname.replace('/source-control/', '/review/')
  if (pathname === url.pathname) {
    throw new Error('Source Control route cannot open standalone Review')
  }
  const params = new URLSearchParams({ scope: 'all' })
  const name = url.searchParams.get('name')
  if (name) {
    params.set('name', name)
  }
  return `${pathname}?${params.toString()}`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function journeyStep(label, run) {
  try {
    return await run()
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    })
  }
}
