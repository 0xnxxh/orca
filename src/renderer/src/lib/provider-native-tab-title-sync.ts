import type { AiVaultListArgs, AiVaultListResult } from '../../../shared/ai-vault-types'
import { isProviderNativeTitleAgent } from '../../../shared/provider-native-session-title'
import type { AppState } from '@/store/types'
import {
  collectProviderNativeTitleRequests,
  type ProviderNativeTitleRequest
} from './provider-native-tab-title-requests'

const RETRY_DELAYS_MS = [1_000, 5_000, 20_000] as const

function requestIdentity(request: ProviderNativeTitleRequest): string {
  return `${request.executionHostId}\0${request.agent}\0${request.providerSession.id}`
}

type SyncDependencies = {
  getState: () => AppState
  listSessions: (args: AiVaultListArgs) => Promise<AiVaultListResult>
  subscribe: (listener: (state: AppState, previous: AppState) => void) => () => void
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number
  clearTimer?: (timer: ReturnType<typeof setTimeout> | number) => void
  now?: () => number
}

export function startProviderNativeTabTitleSync(dependencies: SyncDependencies): () => void {
  const now = dependencies.now ?? Date.now
  const setTimer = dependencies.setTimer ?? setTimeout
  const clearTimer =
    dependencies.clearTimer ??
    ((timer: ReturnType<typeof setTimeout> | number) =>
      clearTimeout(timer as ReturnType<typeof setTimeout>))
  const attempts = new Map<string, { count: number; retryAt: number }>()
  const inFlight = new Set<string>()
  let retryTimer: ReturnType<typeof setTimeout> | number | null = null
  let stopped = false
  let scheduled = false

  const scheduleRetry = (): void => {
    if (retryTimer !== null) {
      clearTimer(retryTimer)
      retryTimer = null
    }
    const retryAt = Math.min(
      ...[...attempts.values()].map((attempt) => attempt.retryAt).filter(Number.isFinite)
    )
    if (!Number.isFinite(retryAt)) {
      return
    }
    retryTimer = setTimer(
      () => {
        retryTimer = null
        schedule()
      },
      Math.max(0, retryAt - now())
    )
  }

  const markMissing = (identity: string): void => {
    const count = (attempts.get(identity)?.count ?? 0) + 1
    const delay = RETRY_DELAYS_MS[count - 1]
    attempts.set(identity, {
      count,
      retryAt: delay === undefined ? Number.POSITIVE_INFINITY : now() + delay
    })
  }

  const scanGroup = async (requests: ProviderNativeTitleRequest[]): Promise<void> => {
    const identities = requests.map(requestIdentity)
    identities.forEach((identity) => inFlight.add(identity))
    try {
      const first = requests[0]!
      const needsDeepScan = requests.some(
        (request) => (attempts.get(requestIdentity(request))?.count ?? 0) > 0
      )
      const result = await dependencies.listSessions({
        executionHostScope: first.executionHostId,
        ...(first.scopePath ? { scopePaths: [first.scopePath] } : {}),
        ...(needsDeepScan ? { unlimited: true } : { limit: 500 }),
        force: true
      })
      if (stopped || result.cancelled) {
        return
      }
      const titleByIdentity = new Map<string, string>()
      for (const session of result.sessions) {
        if (!isProviderNativeTitleAgent(session.agent) || !session.providerNativeTitle?.trim()) {
          continue
        }
        titleByIdentity.set(
          `${session.executionHostId}\0${session.agent}\0${session.sessionId}`,
          session.providerNativeTitle.trim()
        )
      }
      for (const request of requests) {
        const identity = requestIdentity(request)
        const title = titleByIdentity.get(identity)
        if (!title) {
          markMissing(identity)
          continue
        }
        attempts.delete(identity)
        const current = collectProviderNativeTitleRequests(dependencies.getState()).find(
          (candidate) => candidate.tabId === request.tabId
        )
        if (current && requestIdentity(current) === identity) {
          dependencies.getState().setProviderNativeTabTitle(request.tabId, {
            agent: request.agent,
            sessionId: request.providerSession.id,
            title
          })
        }
      }
    } catch {
      identities.forEach(markMissing)
    } finally {
      identities.forEach((identity) => inFlight.delete(identity))
      if (!stopped) {
        scheduleRetry()
      }
    }
  }

  const reconcile = (): void => {
    scheduled = false
    if (stopped) {
      return
    }
    const state = dependencies.getState()
    const requests = collectProviderNativeTitleRequests(state)
    const tabsById = new Map(
      Object.values(state.tabsByWorktree)
        .flat()
        .map((tab) => [tab.id, tab] as const)
    )
    const ready: ProviderNativeTitleRequest[] = []
    for (const request of requests) {
      const stored = tabsById.get(request.tabId)?.providerNativeTitle
      const identityMatches =
        stored?.agent === request.agent && stored.sessionId === request.providerSession.id
      if (identityMatches && stored.title.trim()) {
        attempts.delete(requestIdentity(request))
        continue
      }
      if (stored) {
        state.setProviderNativeTabTitle(request.tabId, null)
      }
      const identity = requestIdentity(request)
      if (
        !inFlight.has(identity) &&
        (attempts.get(identity)?.retryAt ?? Number.NEGATIVE_INFINITY) <= now()
      ) {
        ready.push(request)
      }
    }
    const byHostAndPath = new Map<string, ProviderNativeTitleRequest[]>()
    for (const request of ready) {
      const key = `${request.executionHostId}\0${request.scopePath ?? ''}`
      const group = byHostAndPath.get(key) ?? []
      group.push(request)
      byHostAndPath.set(key, group)
    }
    for (const group of byHostAndPath.values()) {
      void scanGroup(group)
    }
  }

  function schedule(): void {
    if (scheduled || stopped) {
      return
    }
    scheduled = true
    queueMicrotask(reconcile)
  }

  const unsubscribe = dependencies.subscribe((state, previous) => {
    if (
      state.agentStatusByPaneKey !== previous.agentStatusByPaneKey ||
      state.retainedAgentsByPaneKey !== previous.retainedAgentsByPaneKey ||
      state.sleepingAgentSessionsByPaneKey !== previous.sleepingAgentSessionsByPaneKey ||
      state.tabsByWorktree !== previous.tabsByWorktree ||
      state.terminalLayoutsByTabId !== previous.terminalLayoutsByTabId ||
      state.worktreesByRepo !== previous.worktreesByRepo ||
      state.detectedWorktreesByRepo !== previous.detectedWorktreesByRepo ||
      state.folderWorkspaces !== previous.folderWorkspaces
    ) {
      schedule()
    }
  })
  schedule()

  return () => {
    stopped = true
    unsubscribe()
    if (retryTimer !== null) {
      clearTimer(retryTimer)
    }
  }
}
