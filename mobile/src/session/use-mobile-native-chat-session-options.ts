import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAgentSessionOptionCatalog } from '../../../src/shared/agent-session-option-catalog'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../src/shared/native-chat-session-options'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import {
  buildMobileSessionOptionCommand,
  recordMobileOutgoingSessionOptionCommand
} from './mobile-native-chat-session-option-commands'
import {
  applyMobileReportedSessionOptions,
  buildMobileSessionOptionSnapshot,
  clearMobileModelTruth,
  createMobileSessionOptionRecord,
  getTrackedMobileOption,
  isFlipOnlyMidSession,
  matchMobileCatalogModelId,
  type MobileSessionOptionRecord
} from './mobile-native-chat-session-option-state'

export type MobileNativeChatSessionOptionsController = {
  /** Model descriptor first, then the current model's options; empty when the
   *  agent has no catalog. */
  snapshot: SessionOptionDescriptor[]
  /** Descriptor id with a dispatch in flight; the UI disables rows meanwhile. */
  pendingId: string | null
  setOption: (id: string, value: SessionOptionValue) => Promise<boolean>
  invokeAction: (id: string) => Promise<boolean>
  /** Track a slash command the user typed themselves (e.g. `/model sonnet`). */
  recordCommand: (command: string) => void
}

// Why: per-tab records survive chat↔terminal flips and remounts, like desktop's
// scope cache. Bounded so long sessions across many tabs can't grow unbounded.
const MOBILE_SESSION_OPTION_RECORD_CAP = 32
const recordsByScope = new Map<string, MobileSessionOptionRecord>()

function getScopedRecord(scopeKey: string, agent: string): MobileSessionOptionRecord {
  const existing = recordsByScope.get(scopeKey)
  if (existing && existing.agent === agent) {
    return existing
  }
  const created = createMobileSessionOptionRecord(agent)
  if (!recordsByScope.has(scopeKey) && recordsByScope.size >= MOBILE_SESSION_OPTION_RECORD_CAP) {
    const oldest = recordsByScope.keys().next().value
    if (oldest !== undefined) {
      recordsByScope.delete(oldest)
    }
  }
  recordsByScope.set(scopeKey, created)
  return created
}

export function clearMobileSessionOptionRecordsForTests(): void {
  recordsByScope.clear()
}

const EMPTY_SNAPSHOT: SessionOptionDescriptor[] = []

export function useMobileNativeChatSessionOptions(args: {
  agent: string | null
  /** Stable per-tab scope (host + worktree + tab), or null when no tab is active. */
  scopeKey: string | null
  /** Provider model from live agent status, when the hook reported one. */
  reportedModel: string | null
  dispatchCommand: (command: string) => Promise<MobileNativeChatSendOutcome>
  /** A model change that must happen in the agent's own TUI picker was
   *  dispatched — bring the terminal view forward. */
  onAgentPicker?: () => void
}): MobileNativeChatSessionOptionsController {
  const { agent, scopeKey, reportedModel, dispatchCommand, onAgentPicker } = args
  const catalog = useMemo(() => (agent ? getAgentSessionOptionCatalog(agent) : null), [agent])
  const [version, setVersion] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const bump = useCallback(() => setVersion((current) => current + 1), [])
  // Why: ordered applies — a later absolute target must observe the result of
  // an earlier dispatch instead of computing against a stale baseline.
  const applyQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  // Seed the current model from live agent status; hook reports are authority
  // over locally dispatched guesses (desktop 'reported' source parity).
  useEffect(() => {
    if (!catalog || !scopeKey || !agent || !reportedModel) {
      return
    }
    const matched = matchMobileCatalogModelId(catalog, reportedModel)
    if (!matched) {
      return
    }
    const record = getScopedRecord(scopeKey, agent)
    if (applyMobileReportedSessionOptions(record, { model: matched })) {
      bump()
    }
  }, [agent, bump, catalog, reportedModel, scopeKey])

  const snapshot = useMemo(() => {
    if (!catalog || !scopeKey || !agent) {
      return EMPTY_SNAPSHOT
    }
    // Why: `version` invalidates this memo after in-place record mutations.
    void version
    return buildMobileSessionOptionSnapshot({ catalog, record: getScopedRecord(scopeKey, agent) })
  }, [agent, catalog, scopeKey, version])

  const runSerialized = useCallback(<T>(id: string, run: () => Promise<T>): Promise<T> => {
    const chained = applyQueueRef.current.then(run, run)
    applyQueueRef.current = chained.then(
      () => undefined,
      () => undefined
    )
    setPendingId(id)
    void chained.finally(() => setPendingId(null))
    return chained
  }, [])

  const setOption = useCallback(
    (id: string, value: SessionOptionValue): Promise<boolean> => {
      if (!catalog || !scopeKey || !agent) {
        return Promise.resolve(false)
      }
      return runSerialized(id, async () => {
        const record = getScopedRecord(scopeKey, agent)
        const previousModelId = typeof record.model?.value === 'string' ? record.model.value : null
        const apply =
          id === 'model'
            ? catalog.modelApply
            : catalog.models
                .find((model) => model.id === previousModelId)
                ?.options.find((option) => option.id === id)?.apply
        if (!apply || apply.midSession?.kind === 'agent-picker') {
          return false
        }
        const flipOnly = isFlipOnlyMidSession(apply.midSession)
        const trackedToggle = flipOnly
          ? getTrackedMobileOption(record, previousModelId, id)
          : undefined
        if (flipOnly && !trackedToggle) {
          // Why: a flip from an unknown baseline cannot honor an absolute target.
          return false
        }
        // Why: same absolute target must never re-dispatch a flip (would invert the agent).
        if (flipOnly && trackedToggle?.value === value) {
          return true
        }
        const command = buildMobileSessionOptionCommand({
          optionId: id,
          value,
          apply,
          modelId: previousModelId,
          catalog,
          record
        })
        if (!command) {
          return false
        }
        const outcome = await dispatchCommand(command)
        if (outcome === 'rejected') {
          return false
        }
        if (id === 'model') {
          if (typeof value === 'string' && previousModelId !== value) {
            // Why: switching models can reset effort/toggles for the destination model.
            delete record.valuesByModel[value]
          }
          record.model = { value, source: 'dispatched' }
        } else if (previousModelId) {
          // Why: flip-only never heals via agent report — track as applied best-known.
          record.valuesByModel[previousModelId] = {
            ...record.valuesByModel[previousModelId],
            [id]: { value, source: flipOnly ? 'applied' : 'dispatched' }
          }
        }
        bump()
        return true
      })
    },
    [agent, bump, catalog, dispatchCommand, runSerialized, scopeKey]
  )

  const invokeAction = useCallback(
    (id: string): Promise<boolean> => {
      if (!catalog || !scopeKey || !agent) {
        return Promise.resolve(false)
      }
      return runSerialized(id, async () => {
        const record = getScopedRecord(scopeKey, agent)
        const modelId = typeof record.model?.value === 'string' ? record.model.value : null
        const apply =
          id === 'model'
            ? catalog.modelApply
            : catalog.models
                .find((model) => model.id === modelId)
                ?.options.find((option) => option.id === id)?.apply
        const midSession = apply?.midSession
        if (midSession?.kind === 'agent-picker') {
          const outcome = await dispatchCommand(midSession.command)
          if (outcome === 'rejected') {
            return false
          }
          clearMobileModelTruth(record)
          bump()
          onAgentPicker?.()
          return true
        }
        if (isFlipOnlyMidSession(midSession) && !getTrackedMobileOption(record, modelId, id)) {
          // Why: an unknown baseline remains unknown after one inversion.
          return (await dispatchCommand(midSession.command)) !== 'rejected'
        }
        return false
      })
    },
    [agent, bump, catalog, dispatchCommand, onAgentPicker, runSerialized, scopeKey]
  )

  const recordCommand = useCallback(
    (command: string): void => {
      if (!catalog || !scopeKey || !agent) {
        return
      }
      const record = getScopedRecord(scopeKey, agent)
      const result = recordMobileOutgoingSessionOptionCommand({ catalog, record, command })
      if (result.changed) {
        bump()
      }
      if (result.opensAgentPicker) {
        onAgentPicker?.()
      }
    },
    [agent, bump, catalog, onAgentPicker, scopeKey]
  )

  return useMemo(
    () => ({ snapshot, pendingId, setOption, invokeAction, recordCommand }),
    [snapshot, pendingId, setOption, invokeAction, recordCommand]
  )
}
