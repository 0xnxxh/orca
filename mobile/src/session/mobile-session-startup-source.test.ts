import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)
const reconciliationHookSource = readFileSync(
  new URL('./use-mobile-session-tabs-reconciliation.ts', import.meta.url),
  'utf8'
)
const autoCreateHookSource = readFileSync(
  new URL('./use-initial-session-terminal-autocreate.ts', import.meta.url),
  'utf8'
)

function sliceBetween(startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('mobile session startup', () => {
  it('auto-creates one terminal for a newly created empty session', () => {
    expect(source).toContain('useWorktreeSessionTabsLoaded(worktreeId)')
    expect(source).toContain(
      'initialSessionAutoCreateRef.current = createInitialSessionAutoCreateState()'
    )

    const autoCreateCall = sliceBetween(
      'useInitialSessionTerminalAutoCreate({',
      'const connectionVerdict ='
    )
    expect(autoCreateCall).toContain('stateRef: initialSessionAutoCreateRef')
    expect(autoCreateCall).toContain(
      'consumeCreationRoute: () => router.setParams({ created: undefined })'
    )
    expect(autoCreateCall).toContain("newlyCreatedWorkspace: created === '1'")
    expect(autoCreateCall).toContain('visibleTabCount: visibleTabs.length')
    expect(autoCreateCall).toContain('createTerminal: () => void handleCreateTerminal()')

    expect(autoCreateHookSource).toContain('shouldAutoCreateInitialSessionTerminal({')
    expect(autoCreateHookSource).toContain('stateRef.current.autoCreatedForWorktree === worktreeId')
    expect(autoCreateHookSource).toContain('stateRef.current.autoCreatedForWorktree = worktreeId')
    expect(autoCreateHookSource).toContain("connState === 'connected'")
    expect(autoCreateHookSource).toContain('(visibleTabCount > 0 || activeHandle !== null)')
    // Why: both callbacks are re-created every render, so the effect must reach them
    // through useEffectEvent rather than deps or a render-time ref write.
    expect(autoCreateHookSource).toContain('useEffectEvent(args.consumeCreationRoute)')
    expect(autoCreateHookSource).toContain('useEffectEvent(args.createTerminal)')
    expect(autoCreateHookSource).toContain('consumeCreationRoute()')
    expect(autoCreateHookSource).toContain('createTerminal()')
  })

  it('arms the auto-create only until the route has published a tab (#9717)', () => {
    // Emptiness after a populated list is a close, not a cold hydrate.
    expect(source).toContain(
      'initialSessionAutoCreateRef.current.sawSessionTabs ||= nextTabs.length > 0'
    )

    const autoCreateCall = sliceBetween(
      'useInitialSessionTerminalAutoCreate({',
      'const connectionVerdict ='
    )
    expect(autoCreateCall).toContain('stateRef: initialSessionAutoCreateRef')
    expect(autoCreateHookSource).toContain('sawSessionTabs: stateRef.current.sawSessionTabs')
  })

  it('delegates stream ownership while retaining the exact terminal polling cadence', () => {
    expect(source).toContain('useMobileSessionTabsReconciliation<')
    expect(source).toContain('const applicationRevision = ++appliedSessionTabsRevisionRef.current')
    expect(source).toContain('getApplicationRevision: getSessionTabsApplicationRevision')
    expect(source).not.toContain("client.subscribe(\n      'session.tabs.subscribe'")
    expect(reconciliationHookSource).toContain("client.subscribe(\n      'session.tabs.subscribe'")
    expect(reconciliationHookSource).toContain(
      "if (AppState.currentState !== 'active') {\n          controller.setReconciliationActive(false)"
    )
    expect(reconciliationHookSource).toContain('void controller.poll()')
    expect(reconciliationHookSource).toContain('void fetchTerminals()')
    expect(reconciliationHookSource).toContain("AppState.addEventListener('change'")
    expect(reconciliationHookSource).toContain('const interval = setInterval(')
    expect(reconciliationHookSource).toContain('2000')
    expect(reconciliationHookSource).toContain('controller.setReconciliationActive(false)')
    expect(reconciliationHookSource).toContain('clearInterval(interval)')
    expect(reconciliationHookSource).toContain('appStateSubscription.remove()')
  })

  it('loads session tabs without waiting for desktop activation', () => {
    const startupEffect = sliceBetween(
      'void (async () => {',
      'return () => {\n      disposed = true'
    )

    expect(startupEffect).toContain("void client\n          .sendRequest('worktree.activate'")
    expect(startupEffect).toContain("if (client && created !== '1' && !isFloatingWorkspaceRoute)")
    expect(startupEffect).toContain("if (client && created === '1' && !isFloatingWorkspaceRoute)")
    expect(startupEffect).toContain('notifyClients: false')
    expect(startupEffect).toContain("navigation: 'caller'")
    expect(startupEffect).not.toContain("await client\n          .sendRequest('worktree.activate'")
    expect(startupEffect.indexOf("sendRequest('worktree.activate'")).toBeLessThan(
      startupEffect.indexOf('await ensureSessionTabs()')
    )
    expect(startupEffect).toContain('headlessActivationNeedsHostRenderer(response.result)')
    expect(startupEffect).toContain("showToast('Open Orca on the host to wake sleeping agents.'")
  })

  it('fails runtime capability gates closed before probing a replacement client', () => {
    const capabilityEffect = sliceBetween(
      'const hostQueryReplyInputSupportedRef = useRef(false)',
      '// Why: read deviceToken from host record'
    )
    const probeStart = capabilityEffect.indexOf('startRuntimeCapabilityProbe(client,')

    expect(probeStart).toBeGreaterThanOrEqual(0)
    for (const reset of [
      'setBrowserScreencastSupported(null)',
      'setAgentSessionHistorySupported(null)',
      'setQuickCommandsSupported(null)',
      'setShowQuickCommands(false)',
      'hostQueryReplyInputSupportedRef.current = false'
    ]) {
      const resetIndex = capabilityEffect.lastIndexOf(reset)
      expect(resetIndex).toBeGreaterThanOrEqual(0)
      expect(resetIndex).toBeLessThan(probeStart)
    }
  })

  it('activates an already-selected pending terminal tab after hydration', () => {
    expect(source).toContain(
      'const pendingTerminalActivationAttemptRef = useRef<string | null>(null)'
    )
    expect(source).toContain('pendingTerminalActivationAttemptRef.current = null')

    const pendingActivationEffect = sliceBetween(
      'const pendingTabCurrent =',
      'const showLoadingState ='
    )
    const routeResetEffect = sliceBetween(
      '// Why: Expo reuses this screen across worktrees; reset route state',
      "if (connState !== 'connected') {"
    )
    expect(routeResetEffect).toContain('activeSessionTabIdRef.current = null')
    expect(pendingActivationEffect).toContain(
      'activePendingTerminalTab?.id === activeSessionTabIdRef.current'
    )
    expect(pendingActivationEffect).toContain('!pendingTabCurrent')
    expect(pendingActivationEffect).toContain(
      'pendingTerminalActivationAttemptRef.current === activationKey'
    )
    expect(pendingActivationEffect).toContain('sessionTabIntentRef.current.pendingActivationKey(')
    expect(pendingActivationEffect).toContain('activateMobileSessionTab(client,')
    expect(pendingActivationEffect).toContain('tabId: activePendingTerminalTab.id')
    expect(pendingActivationEffect).toContain('leafId: activePendingTerminalTab.leafId')
    expect(pendingActivationEffect).toContain('notifyClients: false')
    expect(pendingActivationEffect).toContain("navigation: 'caller'")
    expect(pendingActivationEffect).toContain(
      'applySessionTabs((response as RpcSuccess).result as SessionTabsResult)'
    )
    expect(pendingActivationEffect).toContain('scheduleDelayedAction(() => void fetchSessionTabs()')
  })

  it('keeps ready terminal taps local while publishing caller selection', () => {
    const readyTerminalSwitch = sliceBetween(
      'const switchTab = useCallback(',
      'const switchSessionTab = useCallback('
    )

    expect(readyTerminalSwitch).not.toContain('focusMobileTerminal(client, handle)')
    expect(readyTerminalSwitch).toContain('activateTab(matchingTab.id, intentRevision)')
  })

  it('lets a newer tab intent supersede delayed created-tab focus', () => {
    const readyTerminalSwitch = sliceBetween(
      'const switchTab = useCallback(',
      'const switchSessionTab = useCallback('
    )
    const sessionTabSwitch = sliceBetween(
      'const switchSessionTab = useCallback(',
      '// Ref to latest switchSessionTab'
    )
    const applySessionTabs = sliceBetween(
      'const applySessionTabs = useCallback(',
      'const readMarkdownTab = useCallback('
    )
    const createTerminal = sliceBetween(
      'async function handleCreateTerminal(',
      '// Quick commands spawn a fresh terminal tab'
    )
    const createMarkdown = sliceBetween(
      'async function handleCreateMarkdownNote()',
      'async function handleCreateBrowser('
    )
    const createBrowser = sliceBetween(
      'async function handleCreateBrowser(',
      '// Keep the ref at the latest handleCreateBrowser'
    )
    const pendingTerminalActivation = sliceBetween(
      '// Why: a server-owned tab can be active but still pending',
      'const showLoadingState'
    )
    const closeSessionTab = sliceBetween(
      'async function handleCloseSessionTab(',
      'const bulkCloseActions'
    )
    const closeTerminal = sliceBetween(
      'async function handleCloseTerminal(',
      'async function handleCloseSessionTab('
    )
    const fetchTerminals = sliceBetween(
      'const fetchTerminals = useCallback(',
      'const applySessionTabs = useCallback('
    )
    const readMarkdown = sliceBetween(
      'const readMarkdownTab = useCallback(',
      'const readFileTab = useCallback('
    )
    const readFile = sliceBetween(
      'const readFileTab = useCallback(',
      'const loadDiffComments = useCallback('
    )
    const readMarkdownEffect = sliceBetween(
      "activeSessionTab?.type !== 'markdown'",
      "activeSessionTab?.type !== 'file'"
    )
    const readFileEffect = sliceBetween(
      "activeSessionTab?.type !== 'file'",
      'async function handleSend'
    )
    const saveMarkdown = sliceBetween(
      'const saveMarkdownTab = useCallback(',
      'const consumeAcceptedSessionTabs = useCallback('
    )
    const routeReset = sliceBetween(
      '// Why: Expo reuses this screen across worktrees; reset route state',
      "if (connState !== 'connected') {"
    )
    const browserNavigation = sliceBetween(
      'async function handleBrowserNavigationCommand(',
      'async function handleRenameTerminal('
    )
    const renameTerminal = sliceBetween(
      'async function handleRenameTerminal(',
      'async function handleCloseTerminal('
    )

    expect(readyTerminalSwitch).toContain('sessionTabIntentRef.current.supersede()')
    expect(sessionTabSwitch).toContain('sessionTabIntentRef.current.supersede()')
    expect(sessionTabSwitch.match(/activateTab\(tab.id, intentRevision\)/g)).toHaveLength(2)
    expect(source).toContain(
      'shouldRetryAfterCutover: sessionTabIntentRef.current.retryWhileCurrent'
    )
    expect(applySessionTabs).toContain(
      'if (followsHost) {\n        sessionTabIntentRef.current.supersede()'
    )
    expect(source).toContain('sessionTabIntentRef.current.setRoute(hostId, worktreeId)')
    expect(createTerminal).toContain(
      'const sameRoute = sessionTabIntentRef.current.isRouteCurrent(hostId, worktreeId)'
    )
    expect(createTerminal).toContain(
      'sameRoute && intentRevision === sessionTabIntentRef.current.revision'
    )
    expect(createTerminal).toContain('if (sameRoute) {')
    expect(createTerminal).toContain(
      'const getRestoreTabId = (): string | null =>\n              selectedSessionTabIdRef.current ?? sessionTabsRef.current[0]?.id ?? null'
    )
    expect(createTerminal).toContain(
      'restoreTabSelection(client, `id:${worktreeId}`, getRestoreTabId)'
    )
    for (const delayedCreate of [createMarkdown, createBrowser]) {
      expect(delayedCreate).toContain('const ownsCreate = startTabCreate(')
      expect(delayedCreate).toContain('if (ownsCreate()) {')
      expect(delayedCreate).toContain('tabCreate.reportCaughtError(')
      expect(delayedCreate).toContain('tabCreate.finish(ownsCreate,')
    }
    expect(pendingTerminalActivation).toContain(
      'sessionTabIntentRef.current.revision !== intentRevision'
    )
    expect(pendingTerminalActivation).toContain(
      'if (sessionTabIntentRef.current.isRouteCurrent(hostId, worktreeId)) {'
    )
    expect(pendingTerminalActivation).toContain(
      'restoreTabSelection(client, `id:${worktreeId}`, () => selectedSessionTabIdRef.current)'
    )
    expect(pendingTerminalActivation).toContain('shouldRetryAfterCutover')
    expect(closeSessionTab).toContain('sessionTabIntentRef.current.supersede()')
    expect(closeSessionTab).toContain(
      'const ownsRoute = sessionTabIntentRef.current.captureRouteOwnership(hostId, worktreeId)'
    )
    expect(closeSessionTab).toContain('if (response.ok && ownsRoute()) {')
    expect(closeTerminal).toContain(
      'const ownsRoute = sessionTabIntentRef.current.captureRouteOwnership(hostId, worktreeId)'
    )
    expect(closeTerminal).toContain('if (response.ok && ownsRoute()) {')
    expect(fetchTerminals).toContain(
      '!sessionTabIntentRef.current.isRouteCurrent(hostId, worktreeId)'
    )
    expect(fetchTerminals).toContain(
      'const ownsRoute = sessionTabIntentRef.current.captureRouteOwnership(hostId, worktreeId)'
    )
    expect(fetchTerminals).toContain('if (response.ok && ownsRequest()) {')
    expect(fetchTerminals).toContain(
      'if (fetchTerminalsInFlightRef.current?.token === requestToken) {'
    )
    for (const readTab of [readMarkdown, readFile]) {
      expect(readTab).toContain(
        'const ownsRoute = sessionTabIntentRef.current.captureRouteOwnership(hostId, worktreeId)'
      )
      expect(readTab).toContain('ownsRoute()')
    }
    for (const readEffect of [readMarkdownEffect, readFileEffect]) {
      expect(readEffect).toContain('activeSessionTab.id !== activeSessionTabIdRef.current')
    }
    expect(saveMarkdown).toContain(
      'const ownsRoute = sessionTabIntentRef.current.captureRouteOwnership(hostId, worktreeId)'
    )
    expect(saveMarkdown).toContain('if (!ownsRoute() ||')
    for (const tabAction of [browserNavigation, renameTerminal]) {
      expect(tabAction).toContain(
        'const ownsRoute = sessionTabIntentRef.current.captureRouteOwnership(hostId, worktreeId)'
      )
      expect(tabAction).toContain('ownsRoute()')
    }
    for (const resetTarget of [
      'setActionTarget(null)',
      'setMarkdownActionTarget(null)',
      'setFileActionTarget(null)',
      'setBrowserActionTarget(null)',
      'setDiscardMarkdownTarget(null)',
      'setRenameTarget(null)'
    ]) {
      expect(routeReset).toContain(resetTarget)
    }
    expect(source).toContain('intentRevision === sessionTabIntentRef.current.revision')
  })

  it('keeps background and pending session-tab activation local to the phone', () => {
    const activationRequests = source.split('activateMobileSessionTab(client,').slice(1)

    expect(activationRequests).toHaveLength(2)
    for (const request of activationRequests) {
      expect(request.slice(0, request.indexOf('})'))).toContain('notifyClients: false')
      expect(request.slice(0, request.indexOf('})'))).toContain("navigation: 'caller'")
    }
  })

  it('keeps dynamic agent rows above fixed New Tab actions', () => {
    const newTabActions = sliceBetween('title="New Tab"', 'onClose={() => setShowCreateTabDrawer')

    expect(newTabActions.indexOf('...createTabAgentActions')).toBeLessThan(
      newTabActions.indexOf("label: 'Terminal'")
    )
    expect(newTabActions.indexOf("label: 'Terminal'")).toBeLessThan(
      newTabActions.indexOf("label: 'Browser'")
    )
    expect(newTabActions.indexOf("label: 'Browser'")).toBeLessThan(
      newTabActions.indexOf("label: 'Markdown Note'")
    )
  })
})
