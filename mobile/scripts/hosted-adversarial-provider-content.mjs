import { WebSocket } from 'ws'
import {
  HOSTED_ADVERSARIAL_MERMAID_MARKER,
  HOSTED_ADVERSARIAL_PROVIDER_ERROR_MARKER,
  HOSTED_ADVERSARIAL_PROVIDER_MARKER,
  HOSTED_ADVERSARIAL_PROVIDER_TITLE_MARKER
} from './hosted-adversarial-provider-fixture.mjs'
import {
  evaluateHostedDocumentWithRetry,
  readHostedWebViewState,
  readHostedWebViewTextPoint,
  waitForVisibleHostedWebView
} from './hosted-webview-cdp-session.mjs'

const PROVIDER_DOM_EXPRESSION = `JSON.stringify((() => {
  const mermaidFrames = Array.from(
    document.querySelectorAll('iframe[title="Mermaid diagram"]')
  ).map((frame) => {
    const sourceUrl = String(frame.getAttribute('src') ?? '');
    let resolvedUrl = null;
    try {
      resolvedUrl = new URL(sourceUrl, location.href);
    } catch {}
    return {
      fragment: resolvedUrl?.hash ?? '',
      height: frame.getBoundingClientRect().height,
      path: resolvedUrl?.pathname ?? '',
      query: resolvedUrl?.search ?? '',
      renderedHeight: Number.parseFloat(frame.style.height),
      sandbox: frame.getAttribute('sandbox'),
      status: frame.getAttribute('data-orca-mermaid-status'),
      urlLeaksSource:
        sourceUrl.includes('Done') ||
        sourceUrl.includes('${HOSTED_ADVERSARIAL_MERMAID_MARKER}') ||
        sourceUrl.includes('Start')
    };
  });
  return {
    titleMarker: String(document.body?.innerText ?? '').includes('${HOSTED_ADVERSARIAL_PROVIDER_TITLE_MARKER}'),
    bodyMarker: String(document.body?.innerText ?? '').includes('${HOSTED_ADVERSARIAL_PROVIDER_MARKER}'),
    errorMarker: String(document.body?.innerText ?? '').includes('${HOSTED_ADVERSARIAL_PROVIDER_ERROR_MARKER}'),
    mermaidMarker: String(document.body?.innerText ?? '').includes('${HOSTED_ADVERSARIAL_MERMAID_MARKER}'),
    mermaidRendered: mermaidFrames.length === 1 && mermaidFrames[0].renderedHeight > 120,
    injectedImages: document.querySelectorAll('img[src="x"]').length,
    titleExecuted: globalThis.${HOSTED_ADVERSARIAL_PROVIDER_TITLE_MARKER} === 1,
    bodyExecuted: globalThis.${HOSTED_ADVERSARIAL_PROVIDER_MARKER} === 1,
    errorExecuted: globalThis.${HOSTED_ADVERSARIAL_PROVIDER_ERROR_MARKER} === 1,
    mermaidFrames
  };
})())`
const TASKS_TOOLBAR_X = 0.87

export async function verifyHostedAdversarialTasks({
  activatePoint,
  discoveryUrl,
  document,
  timeoutMs
}) {
  const filterPoint = await readHostedWebViewTextPoint(document, 'Filter')
  await activatePoint({ x: TASKS_TOOLBAR_X, y: filterPoint.y })
  const tasks = await waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText: HOSTED_ADVERSARIAL_PROVIDER_TITLE_MARKER,
    expectedHrefIncludes: '/tasks',
    timeoutMs
  })
  const evidence = await waitForProviderEvidence(tasks, timeoutMs, {
    errorMarker: true,
    titleMarker: true
  })
  const titlePoint = await readHostedWebViewTextPoint(tasks, 'Tasks')
  await activatePoint({ x: Math.max(0.04, titlePoint.x - 0.12), y: titlePoint.y })
  const workspaceDocument = await waitForVisibleHostedWebView({
    discoveryUrl,
    expectedText: 'Orca Desktop',
    timeoutMs
  })
  return { evidence, workspaceDocument }
}

export async function verifyHostedAdversarialProviderReview({ document, timeoutMs }) {
  const evidence = await waitForProviderEvidence(document, timeoutMs, {
    bodyMarker: true,
    mermaidMarker: true,
    mermaidRendered: true,
    titleMarker: true
  })
  if (
    evidence.mermaidFrames.length !== 1 ||
    evidence.mermaidFrames[0].height <= 0 ||
    evidence.mermaidFrames[0].sandbox !== 'allow-scripts' ||
    evidence.mermaidFrames[0].path !== '/mermaid-frame.html' ||
    evidence.mermaidFrames[0].query !== '' ||
    evidence.mermaidFrames[0].fragment !== '' ||
    evidence.mermaidFrames[0].urlLeaksSource !== false
  ) {
    throw new Error(`Hosted adversarial Mermaid frame is invalid: ${JSON.stringify(evidence)}`)
  }
  return evidence
}

async function waitForProviderEvidence(document, timeoutMs, expected) {
  const deadline = Date.now() + timeoutMs
  let evidence
  while (Date.now() < deadline) {
    evidence = JSON.parse(
      await evaluateHostedDocumentWithRetry(document, PROVIDER_DOM_EXPRESSION, WebSocket)
    )
    if (Object.entries(expected).every(([key, value]) => evidence[key] === value)) {
      assertProviderContentInert(evidence)
      return evidence
    }
    await delay(250)
  }
  const state = await readHostedWebViewState(document)
  throw new Error(
    `Hosted adversarial provider content did not render: ${JSON.stringify({
      evidence,
      bodyText: state.bodyText.slice(0, 2_048)
    })}`
  )
}

function assertProviderContentInert(evidence) {
  if (
    evidence.injectedImages !== 0 ||
    evidence.titleExecuted ||
    evidence.bodyExecuted ||
    evidence.errorExecuted
  ) {
    throw new Error(`Hosted adversarial provider content executed: ${JSON.stringify(evidence)}`)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
