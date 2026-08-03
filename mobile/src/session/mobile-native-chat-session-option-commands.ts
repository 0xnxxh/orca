// Mobile port of desktop's session-option command handling
// (src/renderer/src/components/native-chat/native-chat-session-option-{command-builder,command-matching,command-recording}.ts).
// Metro can only reach src/shared, so the renderer modules cannot be imported.

import {
  findCatalogModel,
  type AgentSessionOptionCatalog,
  type CatalogMidSessionApply,
  type CatalogOptionApply
} from '../../../src/shared/agent-session-option-catalog'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import {
  clearMobileModelTruth,
  clearTrackedMobileOption,
  flattenMobileSessionOptionRecord,
  isFlipOnlyMidSession,
  type MobileSessionOptionRecord
} from './mobile-native-chat-session-option-state'

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

/** Build the PTY command that applies `value` to `optionId` mid-session, or
 *  null when the catalog offers no command shape for it. */
export function buildMobileSessionOptionCommand(args: {
  optionId: string
  value: SessionOptionValue
  apply: CatalogOptionApply
  modelId: string | null
  catalog: AgentSessionOptionCatalog
  record: MobileSessionOptionRecord
}): string | null {
  const midSession = args.apply.midSession
  if (midSession?.kind === 'command') {
    return midSession.build(args.value)
  }
  // Why: a known flip has an absolute target only for local tracking; the
  // command itself always performs one inversion.
  if (midSession?.kind === 'toggle-command') {
    return midSession.command
  }
  if (!args.apply.composedIntoModel || !args.modelId || !args.catalog.composeModelValue) {
    return null
  }
  const model = findCatalogModel(args.catalog, args.modelId)
  const values = flattenMobileSessionOptionRecord(args.record, args.modelId)
  for (const option of model?.options ?? []) {
    values[option.id] ??= option.kind.defaultValue
  }
  values[args.optionId] = args.value
  const composed = args.catalog.composeModelValue(args.modelId, values)
  return args.catalog.modelApply.midSession?.kind === 'command'
    ? args.catalog.modelApply.midSession.build(composed)
    : null
}

function recordCommandApply(args: {
  record: MobileSessionOptionRecord
  optionId: string
  midSession: CatalogMidSessionApply | undefined
  command: string
}): boolean {
  const { record, optionId, midSession, command } = args
  if (!midSession || midSession.kind === 'unsupported') {
    return false
  }
  if (isFlipOnlyMidSession(midSession) && command === midSession.command) {
    const modelId = typeof record.model?.value === 'string' ? record.model.value : null
    clearTrackedMobileOption(record, modelId, optionId)
    return true
  }
  if (isSessionOptionAgentPickerCommand(midSession, command)) {
    clearMobileModelTruth(record)
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
      // Why: a model command can reset model-scoped state, so an older value
      // from a prior visit is no longer evidence about this live session.
      delete record.valuesByModel[value]
    }
    record.model = { value, source: 'dispatched' }
    return true
  }
  if (!previousModelId) {
    return true
  }
  record.valuesByModel[previousModelId] = {
    ...record.valuesByModel[previousModelId],
    [optionId]: { value, source: 'dispatched' }
  }
  return true
}

/** Track a slash command the user typed themselves (e.g. `/model sonnet`) so
 *  the picker state follows manual dispatches too (desktop recordOutgoingCommand). */
export function recordMobileOutgoingSessionOptionCommand(args: {
  catalog: AgentSessionOptionCatalog
  record: MobileSessionOptionRecord
  command: string
}): { changed: boolean; opensAgentPicker: boolean } {
  const { catalog, record } = args
  const command = args.command.trim()
  let opensAgentPicker = isSessionOptionAgentPickerCommand(catalog.modelApply.midSession, command)
  let changed = recordCommandApply({
    record,
    optionId: 'model',
    midSession: catalog.modelApply.midSession,
    command
  })
  const modelId = typeof record.model?.value === 'string' ? record.model.value : null
  const model = modelId ? findCatalogModel(catalog, modelId) : undefined
  for (const option of model?.options ?? []) {
    opensAgentPicker =
      opensAgentPicker || isSessionOptionAgentPickerCommand(option.apply.midSession, command)
    changed =
      recordCommandApply({
        record,
        optionId: option.id,
        midSession: option.apply.midSession,
        command
      }) || changed
  }
  return { changed, opensAgentPicker }
}
