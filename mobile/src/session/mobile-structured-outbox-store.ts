import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AgentJournalMessageItem } from '../../../src/shared/agent-session-journal-types'

export type MobileStructuredOutboxState = 'queued' | 'dispatching' | 'unconfirmed'

export type MobileStructuredOutboxEntry = {
  clientMessageId: string
  sessionId: string
  body: AgentJournalMessageItem
  previewUris: string[]
  state: MobileStructuredOutboxState
  queuedAt: number
  lastAttemptAt: number | null
  retryAfterUnknownSubmittedAt: number | null
}

const STORAGE_PREFIX = 'orca:structuredAgentSessionOutbox:v1:'
export const MAX_MOBILE_STRUCTURED_OUTBOX_ENTRIES = 64

function storageKey(sessionId: string): string {
  return STORAGE_PREFIX + encodeURIComponent(sessionId)
}

function parseEntry(value: unknown, sessionId: string): MobileStructuredOutboxEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const entry = value as Partial<MobileStructuredOutboxEntry>
  const body = entry.body
  if (
    entry.sessionId !== sessionId ||
    typeof entry.clientMessageId !== 'string' ||
    typeof entry.queuedAt !== 'number' ||
    !body ||
    body.kind !== 'message' ||
    body.role !== 'user' ||
    !Array.isArray(body.blocks) ||
    !Array.isArray(entry.previewUris) ||
    !entry.previewUris.every((uri) => typeof uri === 'string') ||
    !['queued', 'dispatching', 'unconfirmed'].includes(entry.state ?? '')
  ) {
    return null
  }
  return {
    clientMessageId: entry.clientMessageId,
    sessionId,
    body,
    previewUris: entry.previewUris,
    state: entry.state as MobileStructuredOutboxState,
    queuedAt: entry.queuedAt,
    lastAttemptAt: typeof entry.lastAttemptAt === 'number' ? entry.lastAttemptAt : null,
    retryAfterUnknownSubmittedAt:
      typeof entry.retryAfterUnknownSubmittedAt === 'number'
        ? entry.retryAfterUnknownSubmittedAt
        : null
  }
}

export async function loadMobileStructuredOutbox(
  sessionId: string
): Promise<MobileStructuredOutboxEntry[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(storageKey(sessionId))) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .slice(-MAX_MOBILE_STRUCTURED_OUTBOX_ENTRIES)
      .map((entry) => parseEntry(entry, sessionId))
      .filter((entry): entry is MobileStructuredOutboxEntry => entry !== null)
      .map((entry) =>
        entry.state === 'dispatching' ? { ...entry, state: 'unconfirmed' as const } : entry
      )
      .sort((left, right) => left.queuedAt - right.queuedAt)
  } catch {
    return []
  }
}

export async function saveMobileStructuredOutbox(
  sessionId: string,
  entries: readonly MobileStructuredOutboxEntry[]
): Promise<void> {
  const bounded = entries.filter((entry) => entry.sessionId === sessionId)
  if (bounded.length > MAX_MOBILE_STRUCTURED_OUTBOX_ENTRIES) {
    throw new Error(`Structured outbox is full (${MAX_MOBILE_STRUCTURED_OUTBOX_ENTRIES} messages)`)
  }
  if (bounded.length === 0) {
    await AsyncStorage.removeItem(storageKey(sessionId))
    return
  }
  await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(bounded))
}
