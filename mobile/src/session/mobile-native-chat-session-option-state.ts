// Mobile port of desktop's live session-option tracking
// (src/renderer/src/components/native-chat/native-chat-session-option-{cache,snapshot,reporting}.ts).
// Live mode only: mobile chat always attaches to a running session. Metro can
// only reach src/shared, so the renderer modules cannot be imported directly.

import {
  findCatalogModel,
  type AgentSessionOptionCatalog,
  type CatalogMidSessionApply,
  type CatalogOption
} from '../../../src/shared/agent-session-option-catalog'
import type {
  SessionOptionDescriptor,
  SessionOptionSelectChoice,
  SessionOptionValue,
  SessionOptionValueSource
} from '../../../src/shared/native-chat-session-options'

export type TrackedMobileSessionOption = {
  value: SessionOptionValue
  source: Exclude<SessionOptionValueSource, 'unknown'>
}

export type MobileSessionOptionRecord = {
  agent: string
  model?: TrackedMobileSessionOption
  valuesByModel: Record<string, Record<string, TrackedMobileSessionOption>>
}

export function createMobileSessionOptionRecord(agent: string): MobileSessionOptionRecord {
  return { agent, valuesByModel: {} }
}

/** One predicate for flip-only mid-session commands so snapshot, apply, and
 *  typed-command recording stay aligned (desktop parity). */
export function isFlipOnlyMidSession(
  midSession: CatalogMidSessionApply | undefined
): midSession is Extract<CatalogMidSessionApply, { kind: 'toggle-command' }> {
  return midSession?.kind === 'toggle-command'
}

export function getTrackedMobileOption(
  record: MobileSessionOptionRecord,
  modelId: string | null,
  optionId: string
): TrackedMobileSessionOption | undefined {
  if (!modelId) {
    return undefined
  }
  return record.valuesByModel[modelId]?.[optionId]
}

export function clearTrackedMobileOption(
  record: MobileSessionOptionRecord,
  modelId: string | null,
  optionId: string
): void {
  if (!modelId) {
    return
  }
  const current = record.valuesByModel[modelId]
  if (!current || !(optionId in current)) {
    return
  }
  const next = { ...current }
  delete next[optionId]
  if (Object.keys(next).length === 0) {
    delete record.valuesByModel[modelId]
  } else {
    record.valuesByModel[modelId] = next
  }
}

export function clearMobileModelTruth(record: MobileSessionOptionRecord): void {
  const modelId = typeof record.model?.value === 'string' ? record.model.value : null
  record.model = undefined
  if (modelId) {
    delete record.valuesByModel[modelId]
  }
}

function choiceWithCurrent(
  choices: readonly SessionOptionSelectChoice[],
  tracked: TrackedMobileSessionOption | undefined
): SessionOptionSelectChoice[] {
  const result = [...choices]
  const current = typeof tracked?.value === 'string' ? tracked.value : null
  if (current && !result.some((choice) => choice.value === current)) {
    result.push({ value: current, label: current })
  }
  return result
}

function liveSettableState(args: {
  apply: { composedIntoModel?: true; midSession?: CatalogMidSessionApply }
  composedModelApply?: { midSession?: CatalogMidSessionApply }
}): Pick<SessionOptionDescriptor, 'settable' | 'disabledReason'> {
  if (args.apply.composedIntoModel && args.composedModelApply?.midSession?.kind === 'command') {
    return { settable: true }
  }
  const midSession = args.apply.midSession
  return midSession && midSession.kind !== 'unsupported'
    ? { settable: true }
    : { settable: false, disabledReason: 'set-when-session-starts' }
}

function liveActionForApply(
  apply: { midSession?: CatalogMidSessionApply },
  tracked: TrackedMobileSessionOption | undefined
): SessionOptionDescriptor['action'] {
  if (apply.midSession?.kind === 'agent-picker') {
    return { type: 'agent-picker' }
  }
  // Why: only unknown flip-only options are actions; once we have a tracked
  // baseline the UI can show absolute On/Off without inventing a start state.
  if (isFlipOnlyMidSession(apply.midSession) && !tracked) {
    return { type: 'toggle-command' }
  }
  return undefined
}

function optionDescriptor(args: {
  option: CatalogOption
  tracked: TrackedMobileSessionOption | undefined
  composedModelApply: AgentSessionOptionCatalog['modelApply']
}): SessionOptionDescriptor | null {
  const { option, tracked, composedModelApply } = args
  const action = liveActionForApply(option.apply, tracked)
  const settable = liveSettableState({ apply: option.apply, composedModelApply })
  if (option.kind.type === 'select') {
    const choices = choiceWithCurrent(option.kind.choices, tracked)
    if (choices.length <= 1) {
      return null
    }
    return {
      id: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
      ...(option.category ? { category: option.category } : {}),
      kind: {
        type: 'select',
        ...(typeof tracked?.value === 'string' ? { currentValue: tracked.value } : {}),
        choices
      },
      valueSource: tracked?.source ?? 'unknown',
      ...settable,
      ...(action ? { action } : {})
    }
  }
  return {
    id: option.id,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
    ...(option.category ? { category: option.category } : {}),
    kind: {
      type: 'boolean',
      ...(typeof tracked?.value === 'boolean' ? { currentValue: tracked.value } : {})
    },
    valueSource: tracked?.source ?? 'unknown',
    ...settable,
    ...(action ? { action } : {})
  }
}

export function buildMobileSessionOptionSnapshot(args: {
  catalog: AgentSessionOptionCatalog
  record: MobileSessionOptionRecord
}): SessionOptionDescriptor[] {
  const { catalog, record } = args
  const modelTracked = record.model
  const modelChoices = choiceWithCurrent(
    catalog.models.map(({ id, label, description }) => ({
      value: id,
      label,
      ...(description ? { description } : {})
    })),
    modelTracked
  )
  const modelAction = liveActionForApply(catalog.modelApply, modelTracked)
  const snapshot: SessionOptionDescriptor[] = [
    {
      id: 'model',
      label: 'Model',
      category: 'model',
      kind: {
        type: 'select',
        ...(typeof modelTracked?.value === 'string' ? { currentValue: modelTracked.value } : {}),
        choices: modelChoices
      },
      valueSource: modelTracked?.source ?? 'unknown',
      ...liveSettableState({ apply: catalog.modelApply }),
      ...(modelAction ? { action: modelAction } : {})
    }
  ]
  if (typeof modelTracked?.value !== 'string') {
    return snapshot
  }
  const model = findCatalogModel(catalog, modelTracked.value)
  const trackedValues = record.valuesByModel[modelTracked.value] ?? {}
  for (const option of model?.options ?? []) {
    const descriptor = optionDescriptor({
      option,
      tracked: trackedValues[option.id],
      composedModelApply: catalog.modelApply
    })
    if (descriptor) {
      snapshot.push(descriptor)
    }
  }
  return snapshot
}

export function flattenMobileSessionOptionRecord(
  record: MobileSessionOptionRecord,
  modelId: string
): Record<string, SessionOptionValue> {
  return {
    model: modelId,
    ...Object.fromEntries(
      Object.entries(record.valuesByModel[modelId] ?? {}).map(([id, tracked]) => [
        id,
        tracked.value
      ])
    )
  }
}

export function applyMobileReportedSessionOptions(
  record: MobileSessionOptionRecord,
  values: Record<string, SessionOptionValue>
): boolean {
  const modelId = typeof values.model === 'string' ? values.model : null
  if (!modelId) {
    return false
  }
  const modelChanged = record.model?.value !== modelId
  let changed = modelChanged || record.model?.source !== 'reported'
  record.model = { value: modelId, source: 'reported' }
  const modelValues = modelChanged ? {} : { ...record.valuesByModel[modelId] }
  for (const [id, value] of Object.entries(values)) {
    if (id === 'model') {
      continue
    }
    const current = modelValues[id]
    if (current?.value !== value || current.source !== 'reported') {
      changed = true
    }
    modelValues[id] = { value, source: 'reported' }
  }
  record.valuesByModel[modelId] = modelValues
  return changed
}

/** Map a hook-reported provider model string (e.g. `claude-sonnet-5`, `gpt-5.5`,
 *  or a display name) onto a catalog model id, or null when unrecognized. */
export function matchMobileCatalogModelId(
  catalog: AgentSessionOptionCatalog,
  reported: string
): string | null {
  const normalized = reported.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  const exact = catalog.models.find((model) => model.id.toLowerCase() === normalized)
  if (exact) {
    return exact.id
  }
  const byLabel = catalog.models.find((model) => model.label.toLowerCase() === normalized)
  if (byLabel) {
    return byLabel.id
  }
  // Why: Claude hooks report ids like `claude-sonnet-5`; the catalog uses the
  // CLI's short aliases. Longest-id-first so an alias can't shadow a longer one.
  const containing = [...catalog.models]
    .sort((left, right) => right.id.length - left.id.length)
    .find((model) => normalized.includes(model.id.toLowerCase()))
  return containing?.id ?? null
}
