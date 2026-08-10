import type {
  AgentJournalCursor,
  AgentJournalRenderItem,
  AgentJournalSnapshot,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import type {
  AgentSessionHistoryPage,
  AgentSessionSubscribeEvent
} from '../../../src/shared/agent-session-wire'

export type MobileStructuredAgentSessionState = {
  epoch: string | null
  cursor: AgentJournalCursor | null
  fence: number | null
  items: AgentJournalRenderItem[]
  submissions: AgentJournalSubmission[]
  hasOlder: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
}

export type MobileStructuredAgentSessionAction =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'event'; event: AgentSessionSubscribeEvent }
  | { type: 'tail-page'; page: AgentSessionHistoryPage }
  | { type: 'older-page'; requestedEpoch: string; page: AgentSessionHistoryPage }

export const EMPTY_MOBILE_STRUCTURED_AGENT_SESSION: MobileStructuredAgentSessionState = {
  epoch: null,
  cursor: null,
  fence: null,
  items: [],
  submissions: [],
  hasOlder: false,
  status: 'idle'
}

function replaceSnapshot(
  snapshot: AgentJournalSnapshot,
  fence: number
): MobileStructuredAgentSessionState {
  return {
    epoch: snapshot.cursor.epoch,
    cursor: snapshot.cursor,
    fence,
    items: [...snapshot.items].sort((left, right) => left.sequence - right.sequence),
    submissions: snapshot.submissions,
    hasOlder: snapshot.items.length >= 40,
    status: 'ready'
  }
}

function mergeItems(
  current: readonly AgentJournalRenderItem[],
  incoming: readonly AgentJournalRenderItem[],
  removedIds: readonly string[]
): AgentJournalRenderItem[] {
  const removed = new Set(removedIds)
  const byId = new Map(
    current.filter((item) => !removed.has(item.itemId)).map((item) => [item.itemId, item])
  )
  for (const item of incoming) {
    const prior = byId.get(item.itemId)
    if (!prior || item.revision >= prior.revision) {
      byId.set(item.itemId, item)
    }
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence)
}

function mergeSubmissions(
  current: readonly AgentJournalSubmission[],
  incoming: readonly AgentJournalSubmission[]
): AgentJournalSubmission[] {
  const byId = new Map(current.map((submission) => [submission.clientMessageId, submission]))
  for (const submission of incoming) {
    byId.set(submission.clientMessageId, submission)
  }
  return [...byId.values()].sort((left, right) => left.submittedAt - right.submittedAt)
}

export function reduceMobileStructuredAgentSession(
  state: MobileStructuredAgentSessionState,
  action: MobileStructuredAgentSessionAction
): MobileStructuredAgentSessionState {
  if (action.type === 'loading') {
    return { ...EMPTY_MOBILE_STRUCTURED_AGENT_SESSION, status: 'loading' }
  }
  if (action.type === 'error') {
    return { ...state, status: 'error', error: action.message }
  }
  if (action.type === 'tail-page') {
    return {
      epoch: action.page.epoch,
      cursor: action.page.liveCursor ?? null,
      fence: action.page.fence ?? null,
      items: action.page.items,
      submissions: action.page.submissions,
      hasOlder: action.page.hasOlder,
      status: 'ready'
    }
  }
  if (action.type === 'older-page') {
    if (state.epoch !== action.requestedEpoch || action.page.epoch !== action.requestedEpoch) {
      return state
    }
    return {
      ...state,
      items: mergeItems(state.items, action.page.items, action.page.removedItemIds),
      submissions: mergeSubmissions(state.submissions, action.page.submissions),
      hasOlder: action.page.hasOlder
    }
  }
  const event = action.event
  if (event.type === 'end') {
    return state
  }
  if (event.type === 'snapshot' || event.type === 'reset') {
    return replaceSnapshot(event.snapshot, event.fence)
  }
  if (state.epoch !== event.batch.cursor.epoch) {
    return state
  }
  if (state.cursor && event.batch.cursor.sequence < state.cursor.sequence) {
    return state
  }
  return {
    ...state,
    cursor: event.batch.cursor,
    items: mergeItems(state.items, event.batch.items, event.batch.removedItemIds),
    submissions: mergeSubmissions(state.submissions, event.batch.submissions),
    status: 'ready',
    error: undefined
  }
}

export function oldestMobileStructuredCursor(
  state: MobileStructuredAgentSessionState
): AgentJournalCursor | null {
  const oldest = state.items[0]
  return state.epoch && oldest ? { epoch: state.epoch, sequence: oldest.sequence } : null
}
