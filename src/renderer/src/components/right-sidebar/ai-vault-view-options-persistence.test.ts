import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_VAULT_AGENTS } from '../../../../shared/ai-vault-types'
import {
  AI_VAULT_VIEW_OPTIONS_STORAGE_KEY,
  createDefaultAiVaultViewOptions,
  enabledAiVaultAgents,
  normalizeAiVaultViewOptions,
  readAiVaultViewOptions,
  writeAiVaultViewOptions
} from './ai-vault-view-options-persistence'
import { AI_VAULT_SESSION_LIMIT_RESET_REVISION } from './ai-vault-session-limit-reset'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI Vault view option persistence', () => {
  it('uses the documented defaults when no stored value exists', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }

    expect(readAiVaultViewOptions(storage)).toEqual(createDefaultAiVaultViewOptions())
  })

  it('normalizes malformed fields and removes unknown or duplicate agents', () => {
    expect(
      normalizeAiVaultViewOptions({
        disabledAgents: ['codex', 'unknown', 'codex', 7],
        sort: 'invalid',
        group: 'agent',
        hideEmptySessions: 'yes',
        sessionLimit: 999
      })
    ).toEqual({
      disabledAgents: ['codex'],
      sort: 'updated',
      group: 'agent',
      hideEmptySessions: false,
      sessionLimit: 250,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
  })

  it('preserves every valid sort, group, and boolean value', () => {
    expect(
      normalizeAiVaultViewOptions({
        disabledAgents: [],
        sort: 'updated',
        group: 'project',
        hideEmptySessions: false,
        sessionLimit: 250
      })
    ).toEqual({
      disabledAgents: [],
      sort: 'updated',
      group: 'project',
      hideEmptySessions: false,
      sessionLimit: 250,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
    expect(
      normalizeAiVaultViewOptions({
        disabledAgents: [],
        sort: 'created',
        group: 'folder',
        hideEmptySessions: true,
        sessionLimit: 1000,
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
        sessionLimitNoticeAcknowledged: true
      })
    ).toEqual({
      disabledAgents: [],
      sort: 'created',
      group: 'folder',
      hideEmptySessions: true,
      sessionLimit: 1000,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
    expect(normalizeAiVaultViewOptions({ group: 'agent' }).group).toBe('agent')
    expect(
      normalizeAiVaultViewOptions({
        sessionLimit: 'unlimited',
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
        sessionLimitNoticeAcknowledged: true
      }).sessionLimit
    ).toBe('unlimited')
  })

  it('resets a stored history depth above the default once and flags the notice', () => {
    const stored = JSON.stringify({ sort: 'created', sessionLimit: 'unlimited' })
    const storage = { getItem: vi.fn(() => stored), setItem: vi.fn() }

    const options = readAiVaultViewOptions(storage)

    expect(options.sessionLimit).toBe(250)
    expect(options.sessionLimitNoticeAcknowledged).toBe(false)
    expect(options.sort).toBe('created')
    // The reset must land in storage immediately, or a later opt-back-up is clamped again.
    expect(storage.setItem).toHaveBeenCalledWith(
      AI_VAULT_VIEW_OPTIONS_STORAGE_KEY,
      JSON.stringify(options)
    )
  })

  it('leaves an already-reset profile untouched on read', () => {
    const stored = JSON.stringify({
      sessionLimit: 1000,
      sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
      sessionLimitNoticeAcknowledged: true
    })
    const storage = { getItem: vi.fn(() => stored), setItem: vi.fn() }

    expect(readAiVaultViewOptions(storage).sessionLimit).toBe(1000)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('preserves a fully cleared agent selection', () => {
    const normalized = normalizeAiVaultViewOptions({
      disabledAgents: [...AI_VAULT_AGENTS],
      sort: 'created',
      group: 'folder',
      hideEmptySessions: true
    })

    expect(normalized.disabledAgents).toEqual([...AI_VAULT_AGENTS])
    expect(enabledAiVaultAgents(normalized.disabledAgents)).toEqual([])
  })

  it('falls back safely when JSON or storage access is unavailable', () => {
    const malformed = { getItem: vi.fn(() => '{not-json'), setItem: vi.fn() }
    const unavailable = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn()
    }

    expect(readAiVaultViewOptions(malformed)).toEqual(createDefaultAiVaultViewOptions())
    expect(readAiVaultViewOptions(unavailable)).toEqual(createDefaultAiVaultViewOptions())
    expect(readAiVaultViewOptions(null)).toEqual(createDefaultAiVaultViewOptions())
  })

  it('falls back when the renderer storage getter is blocked', () => {
    const blockedWindow = {}
    Object.defineProperty(blockedWindow, 'localStorage', {
      get: () => {
        throw new Error('blocked')
      }
    })
    vi.stubGlobal('window', blockedWindow)

    expect(readAiVaultViewOptions()).toEqual(createDefaultAiVaultViewOptions())
    expect(writeAiVaultViewOptions(createDefaultAiVaultViewOptions())).toBe(false)
  })

  it('writes a normalized, versioned per-client value', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }

    expect(
      writeAiVaultViewOptions(
        {
          disabledAgents: ['codex'],
          sort: 'created',
          group: 'folder',
          hideEmptySessions: true,
          sessionLimit: 500,
          sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
          sessionLimitNoticeAcknowledged: true
        },
        storage
      )
    ).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(
      AI_VAULT_VIEW_OPTIONS_STORAGE_KEY,
      JSON.stringify({
        disabledAgents: ['codex'],
        sort: 'created',
        group: 'folder',
        hideEmptySessions: true,
        sessionLimit: 500,
        sessionLimitResetRevision: AI_VAULT_SESSION_LIMIT_RESET_REVISION,
        sessionLimitNoticeAcknowledged: true
      })
    )
  })

  it('reports failed storage writes without throwing', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded')
      })
    }

    expect(writeAiVaultViewOptions(createDefaultAiVaultViewOptions(), storage)).toBe(false)
  })
})
