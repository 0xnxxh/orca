import type {
  AgentSessionOptionCatalog,
  CatalogMidSessionApply,
  CatalogModel,
  CatalogOptionApply
} from './agent-session-option-catalog'
import type { SessionOptionValue } from './native-chat-session-options'
import {
  clearNativeChatSessionModel,
  clearTrackedSessionOption,
  flattenNativeChatSessionOptionRecord,
  isFlipOnlyMidSession,
  type NativeChatSessionOptionRecord
} from './native-chat-session-option-state'

export function parseBuiltSessionOptionCommand(
  build: (value: SessionOptionValue) => string,
  command: string
): string | null {
  const marker = '__orca_session_option_value__'
  const template = build(marker)
  const markerIndex = template.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }
  const prefix = template.slice(0, markerIndex)
  const suffix = template.slice(markerIndex + marker.length)
  if (!command.startsWith(prefix) || !command.endsWith(suffix)) {
    return null
  }
  const value = command.slice(prefix.length, command.length - suffix.length).trim()
  return value || null
}

export function isSessionOptionAgentPickerCommand(
  midSession: CatalogMidSessionApply | undefined,
  command: string
): boolean {
  return (
    (midSession?.kind === 'agent-picker' && command === midSession.command) ||
    (midSession?.kind === 'command' && command === midSession.pickerCommand)
  )
}

export function buildNativeChatSessionOptionCommand(args: {
  optionId: string
  value: SessionOptionValue
  apply: CatalogOptionApply
  modelId: string | null
  catalog: AgentSessionOptionCatalog
  models: readonly CatalogModel[]
  record: NativeChatSessionOptionRecord
}): string | null {
  const midSession = args.apply.midSession
  if (midSession?.kind === 'command') {
    return midSession.build(args.value)
  }
  if (midSession?.kind === 'toggle-command') {
    return midSession.command
  }
  if (!args.apply.composedIntoModel || !args.modelId || !args.catalog.composeModelValue) {
    return null
  }
  const model = args.models.find((candidate) => candidate.id === args.modelId)
  const values = flattenNativeChatSessionOptionRecord(args.record, args.modelId)
  for (const option of model?.options ?? []) {
    values[option.id] ??= option.kind.defaultValue
  }
  values[args.optionId] = args.value
  const composed = args.catalog.composeModelValue(args.modelId, values)
  return args.catalog.modelApply.midSession?.kind === 'command'
    ? args.catalog.modelApply.midSession.build(composed)
    : null
}

type PersistSessionOption = (
  modelId: string | null,
  optionId: string,
  value: SessionOptionValue
) => void

function recordCommandApply(args: {
  record: NativeChatSessionOptionRecord
  optionId: string
  midSession: CatalogMidSessionApply | undefined
  command: string
  persist?: PersistSessionOption
}): boolean {
  const { record, optionId, midSession, command, persist } = args
  if (!midSession || midSession.kind === 'unsupported') {
    return false
  }
  if (isFlipOnlyMidSession(midSession) && command === midSession.command) {
    const modelId = typeof record.model?.value === 'string' ? record.model.value : null
    clearTrackedSessionOption(record, modelId, optionId)
    return true
  }
  if (isSessionOptionAgentPickerCommand(midSession, command)) {
    clearNativeChatSessionModel(record)
    return true
  }
  if (midSession.kind !== 'command') {
    return false
  }
  const value = parseBuiltSessionOptionCommand(midSession.build, command)
  if (!value) {
    return false
  }
  const previousModelId = typeof record.model?.value === 'string' ? record.model.value : null
  if (optionId === 'model') {
    if (previousModelId !== value) {
      delete record.valuesByModel[value]
    }
    record.model = { value, source: 'dispatched' }
    persist?.(value, optionId, value)
    return true
  }
  if (!previousModelId) {
    return true
  }
  record.valuesByModel[previousModelId] = {
    ...record.valuesByModel[previousModelId],
    [optionId]: { value, source: 'dispatched' }
  }
  persist?.(previousModelId, optionId, value)
  return true
}

export function recordNativeChatSessionOptionCommand(args: {
  catalog: AgentSessionOptionCatalog
  models: readonly CatalogModel[]
  record: NativeChatSessionOptionRecord
  command: string
  persist?: PersistSessionOption
}): { changed: boolean; opensAgentPicker: boolean } {
  const { catalog, models, record, persist } = args
  const command = args.command.trim()
  let opensAgentPicker = isSessionOptionAgentPickerCommand(catalog.modelApply.midSession, command)
  let changed = recordCommandApply({
    record,
    optionId: 'model',
    midSession: catalog.modelApply.midSession,
    command,
    persist
  })
  const modelId = typeof record.model?.value === 'string' ? record.model.value : null
  const model = modelId ? models.find((candidate) => candidate.id === modelId) : undefined
  for (const option of model?.options ?? []) {
    opensAgentPicker =
      opensAgentPicker || isSessionOptionAgentPickerCommand(option.apply.midSession, command)
    changed =
      recordCommandApply({
        record,
        optionId: option.id,
        midSession: option.apply.midSession,
        command,
        persist
      }) || changed
  }
  return { changed, opensAgentPicker }
}
