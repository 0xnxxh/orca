import { describe, expect, it } from 'vitest'
import {
  CLAUDE_SESSION_OPTION_CATALOG,
  CODEX_SESSION_OPTION_CATALOG
} from '../../../src/shared/agent-session-option-catalog-claude-codex'
import {
  applyMobileReportedSessionOptions,
  buildMobileSessionOptionSnapshot,
  createMobileSessionOptionRecord,
  matchMobileCatalogModelId,
  type MobileSessionOptionRecord
} from './mobile-native-chat-session-option-state'

function claudeRecord(): MobileSessionOptionRecord {
  return createMobileSessionOptionRecord('claude')
}

describe('buildMobileSessionOptionSnapshot', () => {
  it('offers every catalog model with the current value unknown', () => {
    const snapshot = buildMobileSessionOptionSnapshot({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record: claudeRecord()
    })
    expect(snapshot).toHaveLength(1)
    const model = snapshot[0]!
    expect(model).toMatchObject({ id: 'model', category: 'model', valueSource: 'unknown' })
    if (model.kind.type !== 'select') {
      throw new Error('model descriptor must be a select')
    }
    expect(model.kind.currentValue).toBeUndefined()
    expect(model.kind.choices.map((choice) => choice.value)).toEqual(
      CLAUDE_SESSION_OPTION_CATALOG.models.map((catalogModel) => catalogModel.id)
    )
  })

  it('adds the tracked model’s options once the model is known', () => {
    const record = claudeRecord()
    record.model = { value: 'sonnet', source: 'dispatched' }
    const snapshot = buildMobileSessionOptionSnapshot({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record
    })
    expect(snapshot.map((descriptor) => descriptor.id)).toEqual(['model', 'effort'])
    expect(snapshot[0]).toMatchObject({ valueSource: 'dispatched' })
  })

  it('keeps an untracked reported model visible as an extra choice', () => {
    const record = claudeRecord()
    record.model = { value: 'experimental-model', source: 'reported' }
    const snapshot = buildMobileSessionOptionSnapshot({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record
    })
    const model = snapshot[0]!
    if (model.kind.type !== 'select') {
      throw new Error('model descriptor must be a select')
    }
    expect(model.kind.currentValue).toBe('experimental-model')
    expect(model.kind.choices.at(-1)).toEqual({
      value: 'experimental-model',
      label: 'experimental-model'
    })
  })

  it('exposes Codex model changes as an agent-picker action', () => {
    const snapshot = buildMobileSessionOptionSnapshot({
      catalog: CODEX_SESSION_OPTION_CATALOG,
      record: createMobileSessionOptionRecord('codex')
    })
    expect(snapshot[0]).toMatchObject({ settable: true, action: { type: 'agent-picker' } })
  })

  it('marks flip-only toggles without a baseline as toggle actions', () => {
    const record = claudeRecord()
    record.model = { value: 'opus', source: 'reported' }
    const snapshot = buildMobileSessionOptionSnapshot({
      catalog: CLAUDE_SESSION_OPTION_CATALOG,
      record
    })
    const fastMode = snapshot.find((descriptor) => descriptor.id === 'fastMode')
    expect(fastMode).toMatchObject({ action: { type: 'toggle-command' } })
  })
})

describe('applyMobileReportedSessionOptions', () => {
  it('reports become authority and reset stale per-model values on a model change', () => {
    const record = claudeRecord()
    record.model = { value: 'sonnet', source: 'dispatched' }
    record.valuesByModel.opus = { effort: { value: 'high', source: 'dispatched' } }
    expect(applyMobileReportedSessionOptions(record, { model: 'opus' })).toBe(true)
    expect(record.model).toEqual({ value: 'opus', source: 'reported' })
    // A model change invalidates previously tracked values for the destination.
    expect(record.valuesByModel.opus).toEqual({})
  })

  it('is a no-op when the report matches tracked state', () => {
    const record = claudeRecord()
    record.model = { value: 'sonnet', source: 'reported' }
    expect(applyMobileReportedSessionOptions(record, { model: 'sonnet' })).toBe(false)
  })
})

describe('matchMobileCatalogModelId', () => {
  it('matches exact ids, labels, and provider-id containment', () => {
    expect(matchMobileCatalogModelId(CLAUDE_SESSION_OPTION_CATALOG, 'sonnet')).toBe('sonnet')
    expect(matchMobileCatalogModelId(CLAUDE_SESSION_OPTION_CATALOG, 'Sonnet 5')).toBe('sonnet')
    expect(matchMobileCatalogModelId(CLAUDE_SESSION_OPTION_CATALOG, 'claude-sonnet-5')).toBe(
      'sonnet'
    )
    expect(matchMobileCatalogModelId(CODEX_SESSION_OPTION_CATALOG, 'gpt-5.5')).toBe('gpt-5.5')
  })

  it('returns null for unrecognized reports', () => {
    expect(matchMobileCatalogModelId(CLAUDE_SESSION_OPTION_CATALOG, 'mystery-model')).toBeNull()
    expect(matchMobileCatalogModelId(CLAUDE_SESSION_OPTION_CATALOG, '')).toBeNull()
  })
})
