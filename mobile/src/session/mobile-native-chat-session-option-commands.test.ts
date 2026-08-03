import { describe, expect, it } from 'vitest'
import {
  CLAUDE_SESSION_OPTION_CATALOG,
  CODEX_SESSION_OPTION_CATALOG
} from '../../../src/shared/agent-session-option-catalog-claude-codex'
import {
  buildMobileSessionOptionCommand,
  parseBuiltSessionOptionCommand,
  recordMobileOutgoingSessionOptionCommand
} from './mobile-native-chat-session-option-commands'
import {
  createMobileSessionOptionRecord,
  type MobileSessionOptionRecord
} from './mobile-native-chat-session-option-state'

function claudeRecord(model?: string): MobileSessionOptionRecord {
  const record = createMobileSessionOptionRecord('claude')
  if (model) {
    record.model = { value: model, source: 'dispatched' }
  }
  return record
}

describe('buildMobileSessionOptionCommand', () => {
  it('builds the catalog midSession command for model and options', () => {
    expect(
      buildMobileSessionOptionCommand({
        optionId: 'model',
        value: 'opus',
        apply: CLAUDE_SESSION_OPTION_CATALOG.modelApply,
        modelId: null,
        catalog: CLAUDE_SESSION_OPTION_CATALOG,
        record: claudeRecord()
      })
    ).toBe('/model opus')
    const effortApply = CLAUDE_SESSION_OPTION_CATALOG.models
      .find((model) => model.id === 'sonnet')!
      .options.find((option) => option.id === 'effort')!.apply
    expect(
      buildMobileSessionOptionCommand({
        optionId: 'effort',
        value: 'high',
        apply: effortApply,
        modelId: 'sonnet',
        catalog: CLAUDE_SESSION_OPTION_CATALOG,
        record: claudeRecord('sonnet')
      })
    ).toBe('/effort high')
  })

  it('returns the bare toggle command for flip-only options', () => {
    const fastModeApply = CLAUDE_SESSION_OPTION_CATALOG.models
      .find((model) => model.id === 'opus')!
      .options.find((option) => option.id === 'fastMode')!.apply
    expect(
      buildMobileSessionOptionCommand({
        optionId: 'fastMode',
        value: true,
        apply: fastModeApply,
        modelId: 'opus',
        catalog: CLAUDE_SESSION_OPTION_CATALOG,
        record: claudeRecord('opus')
      })
    ).toBe('/fast')
  })

  it('has no absolute command for agent-picker applies (Codex model)', () => {
    expect(
      buildMobileSessionOptionCommand({
        optionId: 'model',
        value: 'gpt-5.5',
        apply: CODEX_SESSION_OPTION_CATALOG.modelApply,
        modelId: null,
        catalog: CODEX_SESSION_OPTION_CATALOG,
        record: createMobileSessionOptionRecord('codex')
      })
    ).toBeNull()
  })
})

describe('parseBuiltSessionOptionCommand', () => {
  it('recovers the value from a built command and rejects other text', () => {
    const build = (value: unknown): string => `/model ${String(value)}`
    expect(parseBuiltSessionOptionCommand(build, '/model opus')).toBe('opus')
    expect(parseBuiltSessionOptionCommand(build, '/effort high')).toBeNull()
    expect(parseBuiltSessionOptionCommand(build, '/model ')).toBeNull()
  })
})

describe('recordMobileOutgoingSessionOptionCommand', () => {
  it('tracks a typed /model value as dispatched truth', () => {
    const record = claudeRecord()
    const result = recordMobileOutgoingSessionOptionCommand({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record,
      command: '/model sonnet'
    })
    expect(result).toEqual({ changed: true, opensAgentPicker: false })
    expect(record.model).toEqual({ value: 'sonnet', source: 'dispatched' })
  })

  it('tracks a typed option value under the current model', () => {
    const record = claudeRecord('sonnet')
    recordMobileOutgoingSessionOptionCommand({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record,
      command: '/effort low'
    })
    expect(record.valuesByModel.sonnet?.effort).toEqual({ value: 'low', source: 'dispatched' })
  })

  it('clears tracked truth for a bare picker command and reports the agent picker', () => {
    const claudeResult = recordMobileOutgoingSessionOptionCommand({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record: claudeRecord('sonnet'),
      command: '/model'
    })
    expect(claudeResult.opensAgentPicker).toBe(true)
    const codexRecord = createMobileSessionOptionRecord('codex')
    codexRecord.model = { value: 'gpt-5.5', source: 'dispatched' }
    const codexResult = recordMobileOutgoingSessionOptionCommand({
      catalog: CODEX_SESSION_OPTION_CATALOG,
      record: codexRecord,
      command: '/model'
    })
    expect(codexResult).toEqual({ changed: true, opensAgentPicker: true })
    expect(codexRecord.model).toBeUndefined()
  })

  it('clears a flip-only toggle’s tracked baseline on a typed flip', () => {
    const record = claudeRecord('opus')
    record.valuesByModel.opus = { fastMode: { value: true, source: 'applied' } }
    recordMobileOutgoingSessionOptionCommand({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record,
      command: '/fast'
    })
    // A typed flip inverts an unknown-to-us direction; the baseline is gone.
    expect(record.valuesByModel.opus?.fastMode).toBeUndefined()
  })

  it('ignores unrelated commands', () => {
    const record = claudeRecord('sonnet')
    expect(
      recordMobileOutgoingSessionOptionCommand({
        catalog: CLAUDE_SESSION_OPTION_CATALOG,
        record,
        command: '/clear'
      })
    ).toEqual({ changed: false, opensAgentPicker: false })
  })
})
