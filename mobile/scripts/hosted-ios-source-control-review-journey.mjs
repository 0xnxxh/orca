import {
  readHostedWebViewState,
  waitForVisibleHostedWebView
} from './hosted-webview-cdp-session.mjs'
import { readHostedWebViewControlPoint } from './hosted-webview-control-point.mjs'
import { tapHostedIosPoint } from './hosted-ios-emulator-accessibility.mjs'
import { navigateHostedWebViewRoute } from './hosted-webview-route-navigation.mjs'

export async function verifyHostedSourceControlReviewJourney({
  discoveryUrl,
  emulator,
  sessionDocument,
  timeoutMs,
  tapPoint = tapHostedIosPoint
}) {
  const sourceControlPoint = await journeyStep('measure Open source control', () =>
    readHostedWebViewControlPoint(sessionDocument, 'Open source control')
  )
  await journeyStep('tap Open source control', () =>
    tapPoint(emulator, sourceControlPoint, 'Open source control')
  )
  const sourceControl = await journeyStep('wait for Source Control route', () =>
    waitForVisibleHostedWebView({
      discoveryUrl,
      expectedText: 'Source Control',
      expectedHrefIncludes: '/source-control/',
      timeoutMs
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
  const changedFilePoint = await journeyStep(`measure ${changedFileLabel}`, () =>
    readHostedWebViewControlPoint(sourceControl, changedFileLabel)
  )
  await journeyStep(`tap ${changedFileLabel}`, () =>
    tapPoint(emulator, changedFilePoint, changedFileLabel)
  )
  const sessionDiff = await journeyStep('wait for Session diff route', () =>
    waitForVisibleHostedWebView({
      discoveryUrl,
      expectedText: '2 tabs',
      expectedHrefIncludes: '/session/',
      requireInteractiveControls: false,
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
