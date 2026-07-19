import { useEffect, useMemo, useRef, useState } from 'react'
import type { GlobalSettings, TuiAgent } from '../../../../shared/types'
import { CUSTOM_AGENT_ID } from '../../../../shared/commit-message-agent-spec'
import type {
  RepoSourceControlAiOverrides,
  SourceControlAiSettings
} from '../../../../shared/source-control-ai-types'
import type { SourceControlAiRepoUpdate } from '../../../../shared/source-control-ai-recipe-save'
import {
  SOURCE_CONTROL_ACTION_IDS,
  type SourceControlActionId
} from '../../../../shared/source-control-ai-actions'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  hasOwnActionOverride,
  normalizeRepoAiDraft,
  readActionRecipeTextDraft,
  type ActionRecipeTextDraft,
  withRepoAiActionAgent,
  withRepoAiActionMode,
  withRepoAiActionRecipeText,
  withRepoAiCustomCommand,
  withRepoAiEnabled,
  withRepoAiHostedReviewDefault
} from './repository-source-control-ai-draft'
import {
  ACTION_MODE_INHERIT,
  DEFAULT_AGENT_VALUE,
  readInheritedCommandTemplate
} from './repository-source-control-ai-labels'
import { createRepoAiPersistQueue } from './repository-source-control-ai-persist-queue'

type HostedReviewDefaultKey = keyof NonNullable<RepoSourceControlAiOverrides['prCreationDefaults']>

type UseRepositorySourceControlAiGlobalUxArgs = {
  repoId: string
  persistedRepoAi: RepoSourceControlAiOverrides
  settings: GlobalSettings | null
  source: SourceControlAiSettings
  updateRepo: (repoId: string, updates: SourceControlAiRepoUpdate) => void | Promise<boolean>
}

/**
 * Match global Source Control AI save UX for per-repo overrides:
 * - Selects / simple controls persist immediately (optimistic UI)
 * - Action CLI args + command template draft until the per-action Save
 */
export function useRepositorySourceControlAiGlobalUx({
  repoId,
  persistedRepoAi,
  settings,
  source,
  updateRepo
}: UseRepositorySourceControlAiGlobalUxArgs) {
  const mountedRef = useMountedRef()
  const persistedSerialized = useMemo(() => JSON.stringify(persistedRepoAi), [persistedRepoAi])
  const persistedRef = useRef(persistedRepoAi)
  const repoIdRef = useRef(repoId)
  const updateRepoRef = useRef(updateRepo)
  repoIdRef.current = repoId
  updateRepoRef.current = updateRepo

  const [saveError, setSaveError] = useState<string | null>(null)
  // Immediate fields: optimistic copy of persisted (selects write here, then queue).
  const [immediateRepoAi, setImmediateRepoAi] = useState(persistedRepoAi)
  const immediateRepoAiRef = useRef(immediateRepoAi)
  immediateRepoAiRef.current = immediateRepoAi
  // Free-text draft for CLI args + template only (matches global recipe rows).
  const [actionTextDrafts, setActionTextDrafts] = useState<
    Partial<Record<SourceControlActionId, ActionRecipeTextDraft>>
  >({})
  const [savingActionIds, setSavingActionIds] = useState<
    Partial<Record<SourceControlActionId, boolean>>
  >({})
  const lastSyncedRepoIdRef = useRef(repoId)

  const queueRef = useRef(
    createRepoAiPersistQueue({
      getRepoId: () => repoIdRef.current,
      getPersisted: () => persistedRef.current,
      setPersisted: (value) => {
        persistedRef.current = value
      },
      updateRepo: (id, updates) => updateRepoRef.current(id, updates),
      isMounted: () => mountedRef.current,
      onError: (message) => {
        if (mountedRef.current) {
          setSaveError(message)
        }
      }
    })
  )

  useEffect(() => {
    const repoChanged = lastSyncedRepoIdRef.current !== repoId
    lastSyncedRepoIdRef.current = repoId
    persistedRef.current = persistedRepoAi
    if (repoChanged) {
      setImmediateRepoAi(persistedRepoAi)
      setActionTextDrafts({})
      setSaveError(null)
      return
    }
    // Adopt persisted for clean immediate fields; keep in-flight text drafts.
    setImmediateRepoAi(persistedRepoAi)
    setActionTextDrafts((current) => {
      const next: Partial<Record<SourceControlActionId, ActionRecipeTextDraft>> = {}
      for (const actionId of SOURCE_CONTROL_ACTION_IDS) {
        const draft = current[actionId]
        if (!draft || !hasOwnActionOverride(persistedRepoAi.actionOverrides, actionId)) {
          continue
        }
        const persistedText = readActionRecipeTextDraft(persistedRepoAi, actionId)
        if (
          draft.commandInputTemplate !== persistedText.commandInputTemplate ||
          draft.agentArgs !== persistedText.agentArgs
        ) {
          next[actionId] = draft
        }
      }
      return next
    })
  }, [persistedSerialized, persistedRepoAi, repoId])

  const persist = (
    transform: (base: RepoSourceControlAiOverrides) => RepoSourceControlAiOverrides
  ): void => {
    setSaveError(null)
    void queueRef.current.persistTransform(transform)
  }

  const updateEnablement = (value: boolean | undefined): void => {
    const next = withRepoAiEnabled(immediateRepoAiRef.current, value)
    setImmediateRepoAi(next)
    immediateRepoAiRef.current = next
    persist((base) => withRepoAiEnabled(base, value))
  }

  const updateCustomCommand = (value: string | undefined): void => {
    const next = withRepoAiCustomCommand(immediateRepoAiRef.current, value)
    setImmediateRepoAi(next)
    immediateRepoAiRef.current = next
    persist((base) => withRepoAiCustomCommand(base, value))
  }

  const updateHostedReviewDefault = (key: HostedReviewDefaultKey, value: string): void => {
    const tri = value === 'on' || value === 'off' || value === 'inherit' ? value : 'inherit'
    const next = withRepoAiHostedReviewDefault(immediateRepoAiRef.current, key, tri)
    setImmediateRepoAi(next)
    immediateRepoAiRef.current = next
    persist((base) => withRepoAiHostedReviewDefault(base, key, tri))
  }

  const updateActionMode = (actionId: SourceControlActionId, mode: string): void => {
    const nextMode = mode === ACTION_MODE_INHERIT ? 'inherit' : 'override'
    if (nextMode === 'inherit') {
      setActionTextDrafts((current) => {
        const { [actionId]: _removed, ...rest } = current
        return rest
      })
    }
    const next = withRepoAiActionMode(immediateRepoAiRef.current, settings, actionId, nextMode)
    setImmediateRepoAi(next)
    immediateRepoAiRef.current = next
    persist((base) => withRepoAiActionMode(base, settings, actionId, nextMode))
  }

  const updateActionAgent = (actionId: SourceControlActionId, value: string): void => {
    const agentId =
      value === DEFAULT_AGENT_VALUE
        ? null
        : value === CUSTOM_AGENT_ID
          ? CUSTOM_AGENT_ID
          : (value as TuiAgent)
    const next = withRepoAiActionAgent(immediateRepoAiRef.current, settings, actionId, agentId)
    setImmediateRepoAi(next)
    immediateRepoAiRef.current = next
    persist((base) => withRepoAiActionAgent(base, settings, actionId, agentId))
  }

  const updateActionTemplate = (actionId: SourceControlActionId, value: string): void => {
    setActionTextDrafts((current) => ({
      ...current,
      [actionId]: {
        ...(current[actionId] ?? readActionRecipeTextDraft(immediateRepoAiRef.current, actionId)),
        commandInputTemplate: value
      }
    }))
  }

  const updateActionAgentArgs = (actionId: SourceControlActionId, value: string): void => {
    setActionTextDrafts((current) => ({
      ...current,
      [actionId]: {
        ...(current[actionId] ?? readActionRecipeTextDraft(immediateRepoAiRef.current, actionId)),
        agentArgs: value
      }
    }))
  }

  const appendVariable = (actionId: SourceControlActionId, variable: string): void => {
    const draft =
      actionTextDrafts[actionId] ?? readActionRecipeTextDraft(immediateRepoAiRef.current, actionId)
    const currentTemplate =
      draft.commandInputTemplate.length > 0
        ? draft.commandInputTemplate
        : readInheritedCommandTemplate(source, actionId)
    const separator = currentTemplate.endsWith('\n') || currentTemplate.length === 0 ? '' : ' '
    updateActionTemplate(actionId, `${currentTemplate}${separator}{${variable}}`)
  }

  const actionDirtyById = useMemo(() => {
    return Object.fromEntries(
      SOURCE_CONTROL_ACTION_IDS.map((actionId) => {
        if (!hasOwnActionOverride(immediateRepoAi.actionOverrides, actionId)) {
          return [actionId, false]
        }
        const draft =
          actionTextDrafts[actionId] ?? readActionRecipeTextDraft(immediateRepoAi, actionId)
        const base = readActionRecipeTextDraft(persistedRepoAi, actionId)
        // Prefer persisted text as base; if override is only optimistic, use immediate.
        const compareBase = hasOwnActionOverride(persistedRepoAi.actionOverrides, actionId)
          ? base
          : readActionRecipeTextDraft(immediateRepoAi, actionId)
        return [
          actionId,
          draft.commandInputTemplate !== compareBase.commandInputTemplate ||
            draft.agentArgs !== compareBase.agentArgs
        ]
      })
    ) as Record<SourceControlActionId, boolean>
  }, [actionTextDrafts, immediateRepoAi, persistedRepoAi])

  const saveActionRecipeText = async (actionId: SourceControlActionId): Promise<void> => {
    if (!actionDirtyById[actionId] || savingActionIds[actionId]) {
      return
    }
    const draft =
      actionTextDrafts[actionId] ?? readActionRecipeTextDraft(immediateRepoAiRef.current, actionId)
    setSavingActionIds((current) => ({ ...current, [actionId]: true }))
    setSaveError(null)
    try {
      await queueRef.current.persistTransform((base) => {
        let next = base
        if (!hasOwnActionOverride(next.actionOverrides, actionId)) {
          next = withRepoAiActionMode(next, settings, actionId, 'override')
        }
        return withRepoAiActionRecipeText(next, settings, actionId, draft)
      })
      // Layer saved text into immediate so UI stays consistent before prop refresh.
      setImmediateRepoAi((current) =>
        withRepoAiActionRecipeText(current, settings, actionId, draft)
      )
      setActionTextDrafts((current) => {
        const { [actionId]: _removed, ...rest } = current
        return rest
      })
    } finally {
      if (mountedRef.current) {
        setSavingActionIds((current) => ({ ...current, [actionId]: false }))
      }
    }
  }

  const discardActionRecipeText = (actionId: SourceControlActionId): void => {
    setActionTextDrafts((current) => {
      const { [actionId]: _removed, ...rest } = current
      return rest
    })
  }

  const displayRepoAi = useMemo(() => {
    let next = immediateRepoAi
    for (const actionId of SOURCE_CONTROL_ACTION_IDS) {
      const draft = actionTextDrafts[actionId]
      if (!draft || !hasOwnActionOverride(next.actionOverrides, actionId)) {
        continue
      }
      next = {
        ...next,
        actionOverrides: {
          ...next.actionOverrides,
          [actionId]: {
            agentId: next.actionOverrides?.[actionId]?.agentId ?? null,
            commandInputTemplate: draft.commandInputTemplate,
            agentArgs: draft.agentArgs
          }
        }
      }
    }
    return next
  }, [actionTextDrafts, immediateRepoAi])

  return {
    displayRepoAi,
    saveError,
    actionDirtyById,
    savingActionIds,
    updateEnablement,
    updateCustomCommand,
    updateHostedReviewDefault,
    updateActionMode,
    updateActionAgent,
    updateActionTemplate,
    updateActionAgentArgs,
    appendVariable,
    saveActionRecipeText,
    discardActionRecipeText
  }
}

export function normalizePersistedRepoAi(
  value: RepoSourceControlAiOverrides | null | undefined
): RepoSourceControlAiOverrides {
  return normalizeRepoAiDraft(value)
}
