import { describe, expect, it } from 'vitest'
import { AI_VAULT_SESSION_QUIESCENCE_MS } from '../../../../shared/ai-vault-session-deletion'
import { aiVaultSessionDeleteBlockedReason } from './ai-vault-session-deletability'

// translate() with no loaded catalog returns the English fallback, so these
// assertions pin the English copy as well as the gate order.
const NON_LOCAL = 'Only sessions on this device can be deleted.'
const SYNTHETIC = "This session can't be deleted from Orca."
const LIVE = 'This session is still running — wait for it to finish before deleting.'
const RECENTLY_ACTIVE = 'This session was active moments ago — wait a few minutes before deleting.'

// Long past the quiescence window against any real clock, so the cases below
// exercise the gate they name rather than the recency gate.
const QUIET_SINCE = '2020-01-01T00:00:00.000Z'

const localGeminiSession = {
  agent: 'gemini' as const,
  executionHostId: 'local' as const,
  filePath: '/home/user/.gemini/sessions/log.jsonl',
  modifiedAt: QUIET_SINCE
}

describe('aiVaultSessionDeleteBlockedReason', () => {
  it('offers Delete for a deletable agent on a local, real path', () => {
    expect(aiVaultSessionDeleteBlockedReason(localGeminiSession)).toBeNull()
  })

  it('offers Delete for a directory-shaped agent (claude)', () => {
    expect(
      aiVaultSessionDeleteBlockedReason({
        agent: 'claude',
        executionHostId: 'local',
        filePath: '/home/user/.claude/projects/-proj/sess-1.jsonl',
        modifiedAt: QUIET_SINCE
      })
    ).toBeNull()
  })

  it('tells the user to wait while the agent is still running', () => {
    for (const live of ['working', 'blocked', 'waiting'] as const) {
      expect(aiVaultSessionDeleteBlockedReason(localGeminiSession, live)).toBe(LIVE)
    }
  })

  it('offers Delete for a finished session (done) and one with no live state', () => {
    expect(aiVaultSessionDeleteBlockedReason(localGeminiSession, 'done')).toBeNull()
    expect(aiVaultSessionDeleteBlockedReason(localGeminiSession, null)).toBeNull()
  })

  it('keeps the permanent reason over "running" for an unsupported live session', () => {
    // A live but unsupported agent stays "unsupported" — it would never become
    // deletable, so "wait for it to finish" would mislead.
    expect(
      aiVaultSessionDeleteBlockedReason(
        {
          agent: 'codex',
          executionHostId: 'local',
          filePath: '/home/user/.codex/x.jsonl',
          modifiedAt: QUIET_SINCE
        },
        'working'
      )
    ).toBe("Codex sessions can't be deleted from Orca.")
  })

  it('blocks ssh- and runtime-hosted sessions regardless of agent', () => {
    for (const executionHostId of ['ssh:dev-box', 'runtime:gpu-box'] as const) {
      expect(aiVaultSessionDeleteBlockedReason({ ...localGeminiSession, executionHostId })).toBe(
        NON_LOCAL
      )
    }
  })

  it('blocks a synthetic OpenCode SQLite row identity', () => {
    expect(
      aiVaultSessionDeleteBlockedReason({
        agent: 'opencode',
        executionHostId: 'local',
        filePath: '/home/user/.opencode/db.sqlite#sess_123',
        modifiedAt: QUIET_SINCE
      })
    ).toBe(SYNTHETIC)
  })

  it('names the agent without explaining why it is unsupported', () => {
    expect(
      aiVaultSessionDeleteBlockedReason({
        agent: 'opencode',
        executionHostId: 'local',
        filePath: '/home/user/.opencode/sessions/log.jsonl',
        modifiedAt: QUIET_SINCE
      })
    ).toBe("OpenCode sessions can't be deleted from Orca.")
  })

  it('gives a multi-cause agent (antigravity) the same single sentence', () => {
    expect(
      aiVaultSessionDeleteBlockedReason({
        agent: 'antigravity',
        executionHostId: 'local',
        filePath: '/home/user/.antigravity/brain/conv-1/.system_generated/logs/transcript.jsonl',
        modifiedAt: QUIET_SINCE
      })
    ).toBe("Antigravity sessions can't be deleted from Orca.")
  })

  // An agent Orca never spawned reports no live state, so the transcript's own
  // write time is the only evidence it still has an owner. Main applies the same
  // window, which keeps what the row offers a subset of what main authorizes.
  describe('recently-active gate', () => {
    const NOW_MS = Date.parse('2026-08-08T12:00:00.000Z')
    const modifiedAgo = (ms: number) => new Date(NOW_MS - ms).toISOString()

    it('blocks a session whose transcript was written inside the window', () => {
      expect(
        aiVaultSessionDeleteBlockedReason(
          { ...localGeminiSession, modifiedAt: modifiedAgo(1_000) },
          null,
          NOW_MS
        )
      ).toBe(RECENTLY_ACTIVE)
    })

    it('offers Delete once the window has fully elapsed', () => {
      expect(
        aiVaultSessionDeleteBlockedReason(
          { ...localGeminiSession, modifiedAt: modifiedAgo(AI_VAULT_SESSION_QUIESCENCE_MS) },
          null,
          NOW_MS
        )
      ).toBeNull()
    })

    it('blocks one millisecond short of the window', () => {
      expect(
        aiVaultSessionDeleteBlockedReason(
          { ...localGeminiSession, modifiedAt: modifiedAgo(AI_VAULT_SESSION_QUIESCENCE_MS - 1) },
          null,
          NOW_MS
        )
      ).toBe(RECENTLY_ACTIVE)
    })

    it.each([
      ['unparsable', 'not a date'],
      ['empty', ''],
      ['future-dated (clock skew)', '2026-08-08T12:05:00.000Z']
    ])('blocks a %s modifiedAt', (_name, modifiedAt) => {
      expect(
        aiVaultSessionDeleteBlockedReason({ ...localGeminiSession, modifiedAt }, null, NOW_MS)
      ).toBe(RECENTLY_ACTIVE)
    })

    it('keeps the live reason ahead of the recency reason', () => {
      expect(
        aiVaultSessionDeleteBlockedReason(
          { ...localGeminiSession, modifiedAt: modifiedAgo(1_000) },
          'working',
          NOW_MS
        )
      ).toBe(LIVE)
    })
  })

  it('prioritizes the host gate over the unsupported-agent reason', () => {
    expect(
      aiVaultSessionDeleteBlockedReason({
        agent: 'claude',
        executionHostId: 'ssh:dev-box',
        filePath: '/home/user/.claude/sessions/sess-dir/log.jsonl',
        modifiedAt: QUIET_SINCE
      })
    ).toBe(NON_LOCAL)
  })
})
