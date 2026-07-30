export const STARTUP_EVENT_CLOCK_SEMANTICS = {
  harnessMs: 'Milliseconds on the benchmark parent clock at complete-line receipt.',
  t: 'Milliseconds on the Electron main process performance.now() clock.',
  rendererT: 'Milliseconds on the main-window renderer performance.now() clock.'
}

function parseDetails(detailText) {
  const details = {}
  const pairPattern = /(?:^|\s)([A-Za-z][\w-]*)=(.*?)(?=\s+[A-Za-z][\w-]*=|$)/g
  for (const match of detailText.matchAll(pairPattern)) {
    let value = match[2]
    try {
      value = JSON.parse(value)
    } catch {
      // Keep diagnostic values emitted without JSON encoding as strings.
    }
    details[match[1]] = value
  }
  return details
}

export function parseStartupLine(line) {
  const match = /^\[(bootstrap|startup)\] (\S+)(.*)$/.exec(line)
  if (!match) {
    return null
  }
  return {
    source: match[1],
    event: match[2],
    details: parseDetails(match[3].trim())
  }
}

function eventTime(events, name, clock) {
  const entry = events.find((event) => event.event === name)
  if (!entry) {
    return null
  }
  if (clock === 'harnessMs') {
    return typeof entry.harnessMs === 'number' ? entry.harnessMs : null
  }
  const value = entry.details[clock]
  return typeof value === 'number' ? value : null
}

function clockDelta(events, from, to, clock = 't') {
  const startedAt = eventTime(events, from, clock)
  const finishedAt = eventTime(events, to, clock)
  return startedAt !== null && finishedAt !== null ? finishedAt - startedAt : null
}

function eventDetailsNumber(events, name, key) {
  const value = events.find((event) => event.event === name)?.details[key]
  return typeof value === 'number' ? value : null
}

function maxEventDetailsNumber(events, name, key) {
  let max = null
  for (const event of events) {
    if (event.event !== name) {
      continue
    }
    const value = event.details[key]
    if (typeof value === 'number' && (max === null || value > max)) {
      max = value
    }
  }
  return max
}

export function deriveStartupPhases(events) {
  const aclStart = eventTime(events, 'acl-grant-start', 't')
  const aclDone = eventTime(events, 'acl-grant-done', 't')
  return {
    spawnToBundleEnterMs: eventTime(events, 'bundle-enter', 'harnessMs'),
    synchronousBundleAndDependencyEvaluationMs: clockDelta(
      events,
      'bundle-enter',
      'bundle-evaluation-complete'
    ),
    bundleEvaluationCompleteToAppReadyMs: clockDelta(
      events,
      'bundle-evaluation-complete',
      'app-ready'
    ),
    appReadyToServicesInitializedMs: clockDelta(events, 'app-ready', 'services-initialized'),
    servicesInitializedToFirstReactCommitMs: clockDelta(
      events,
      'services-initialized',
      'renderer-first-react-commit'
    ),
    firstReactCommitToShellPaintedMs: clockDelta(
      events,
      'renderer-first-react-commit',
      'renderer-shell-painted',
      'rendererT'
    ),
    totalToFirstReactCommitMs: eventTime(events, 'renderer-first-react-commit', 'harnessMs'),
    totalToShellPaintedMs: eventTime(events, 'renderer-shell-painted', 'harnessMs'),
    startupJsonParseMs: clockDelta(
      events,
      'persistence-json-parse-start',
      'persistence-json-parse-done'
    ),
    startupStoreLoadMs: clockDelta(events, 'persistence-load-start', 'persistence-load-done'),
    spawnToAppReady: eventTime(events, 'app-ready', 'harnessMs'),
    appReadyToServices: clockDelta(events, 'app-ready', 'services-initialized'),
    servicesToI18n: clockDelta(events, 'services-initialized', 'i18n-ready'),
    i18nToOpenWindow: clockDelta(events, 'i18n-ready', 'open-main-window-start'),
    daemonInitMs: clockDelta(events, 'daemon-init-start', 'daemon-init-done'),
    aclGrantMs: aclStart !== null && aclDone !== null ? aclDone - aclStart : null,
    windowCreatedToLoadStart: clockDelta(events, 'window-created', 'load-start'),
    windowCreatedToLoaded: clockDelta(events, 'window-created', 'did-finish-load'),
    totalToWindowCreated: eventTime(events, 'window-created', 'harnessMs'),
    totalToDidFinishLoad: eventTime(events, 'did-finish-load', 'harnessMs'),
    didFinishLoadToWorkspaceReady: clockDelta(
      events,
      'did-finish-load',
      'renderer-startup-hydration-done'
    ),
    totalToWorkspaceReady: eventTime(events, 'renderer-startup-hydration-done', 'harnessMs'),
    rendererReconnectTerminalsMs:
      eventDetailsNumber(events, 'renderer-reconnect-terminals-done', 'durationMs') ??
      clockDelta(
        events,
        'renderer-first-window-services-await-done',
        'renderer-reconnect-terminals-done'
      ),
    maxEventLoopStallMs: maxEventDetailsNumber(events, 'event-loop-stall', 'maxGapMs')
  }
}
