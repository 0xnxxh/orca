import { describe, expect, it } from 'vitest'
import {
  agentInputLineClearedSeededDraft,
  agentInputLineShowsSeededDraft,
  planNativeChatLaunchDraftSend
} from './native-chat-launch-draft-send'
import {
  AGENT_TUI_CLEAR_INPUT_LINE,
  buildAgentTuiClearInputForText
} from '../../../../shared/agent-tui-input-clear'

const SEEDED = 'Linked Linear issue: ABC-123\nhttps://linear.app/x/issue/ABC-123'

/** Claude's frame: the input line and its continuation rows sit last. */
const screenHoldingDraft = [
  '  ▘▘ ▝▝    ~/repo',
  '────────────────────────────────────────',
  '❯ Linked Linear issue: ABC-123',
  '  https://linear.app/x/issue/ABC-123',
  '────────────────────────────────────────'
].join('\n')

const screenClear = [
  '  ▘▘ ▝▝    ~/repo',
  '────────────────────────────────────────',
  '❯ Try "create a util logging.py that..."',
  '────────────────────────────────────────'
].join('\n')

const plan = (over: Partial<Parameters<typeof planNativeChatLaunchDraftSend>[0]> = {}) =>
  planNativeChatLaunchDraftSend({
    seededText: SEEDED,
    text: SEEDED,
    hasImages: false,
    readScreen: () => screenHoldingDraft,
    ...over
  })

describe('planNativeChatLaunchDraftSend', () => {
  it('submits in place when the composer still holds exactly the injected draft', () => {
    expect(plan()).toEqual({ kind: 'submit-in-place' })
  })

  it('keeps the ordinary send path when nothing is parked on the line', () => {
    expect(plan({ seededText: null })).toEqual({ kind: 'default' })
    expect(plan({ seededText: '   ' })).toEqual({ kind: 'default' })
  })

  it('replaces the draft when the user edited it, sizing the clear from the INJECTED text', () => {
    // The buffer holds what was injected, not what the composer now shows — a
    // burst sized from the (possibly one-line) edit would leave earlier lines.
    const result = plan({ text: 'just one line now' })
    expect(result).toEqual({
      kind: 'replace-draft',
      clearInput: buildAgentTuiClearInputForText(SEEDED),
      seededText: SEEDED
    })
  })

  it('never submits in place for an image send, but still clears every draft line', () => {
    const result = plan({ hasImages: true })
    expect(result).toEqual({
      kind: 'replace-draft',
      clearInput: buildAgentTuiClearInputForText(SEEDED),
      seededText: SEEDED
    })
  })

  // The hazard: the user can clear or retype the TUI line directly in terminal
  // view while the composer copy lives on. Pressing Enter then submits the wrong
  // buffer — or an empty one — and the message is silently lost.
  it('falls back to replace-draft when the input line no longer shows the draft', () => {
    expect(plan({ readScreen: () => screenClear }).kind).toBe('replace-draft')
  })

  it('falls back to replace-draft when the screen cannot be read at all', () => {
    expect(plan({ readScreen: () => null }).kind).toBe('replace-draft')
    expect(plan({ readScreen: () => undefined }).kind).toBe('replace-draft')
  })

  it('sizes a multi-line clear well past a single Ctrl+U', () => {
    const result = plan({ text: 'edited' })
    expect(result.kind === 'replace-draft' && result.clearInput.length).toBeGreaterThan(
      AGENT_TUI_CLEAR_INPUT_LINE.length
    )
  })
})

describe('agentInputLineShowsSeededDraft', () => {
  it('sees the draft still parked on the input line', () => {
    expect(agentInputLineShowsSeededDraft(screenHoldingDraft, SEEDED)).toBe(true)
  })

  it('reports gone once the TUI redraws its placeholder', () => {
    expect(agentInputLineShowsSeededDraft(screenClear, SEEDED)).toBe(false)
  })

  it('reads codex frames too', () => {
    const codex = ['› Linked Linear issue: ABC-123', '  gpt-5.6 · ~/repo'].join('\n')
    expect(agentInputLineShowsSeededDraft(codex, SEEDED)).toBe(true)
  })

  it('ignores the same text sitting ABOVE as an already-sent turn', () => {
    // Otherwise a sent draft reads as residue forever and every send re-clears.
    const afterSend = [
      '> Linked Linear issue: ABC-123',
      '  https://linear.app/x/issue/ABC-123',
      '────────────────────────────────────────',
      '❯ Try "create a util logging.py that..."',
      '────────────────────────────────────────'
    ].join('\n')
    expect(agentInputLineShowsSeededDraft(afterSend, SEEDED)).toBe(false)
  })

  it('still sees a draft whose first line WRAPPED across rows', () => {
    // The serializer breaks a wrapped line with a newline. A fingerprint long
    // enough to span that break would miss and report the draft gone — the
    // unsafe direction, since the caller would then paste on top of it.
    const wrapped = [
      '────────────────────',
      '❯ Linked Linear issu',
      '  e: ABC-123',
      '  https://linear.app',
      '────────────────────'
    ].join('\n')
    expect(agentInputLineShowsSeededDraft(wrapped, SEEDED)).toBe(true)
  })

  it('returns null — not a verdict — when nothing can be observed', () => {
    expect(agentInputLineShowsSeededDraft(null, SEEDED)).toBeNull()
    expect(agentInputLineShowsSeededDraft('no prompt glyph anywhere', SEEDED)).toBeNull()
    expect(agentInputLineShowsSeededDraft(screenHoldingDraft, '   ')).toBeNull()
  })

  it('matches through the ANSI the serializer leaves in the frame', () => {
    const ansi = `[2m❯[0m [38;5;1mLinked Linear issue: ABC-123[0m`
    expect(agentInputLineShowsSeededDraft(ansi, SEEDED)).toBe(true)
  })
})

describe('agentInputLineClearedSeededDraft', () => {
  it('confirms cleared only on a positive observation that the draft is gone', () => {
    expect(agentInputLineClearedSeededDraft(screenClear, SEEDED)).toBe(true)
  })

  it('treats an unreadable screen as NOT cleared so the caller re-clears', () => {
    // Wrong in this direction costs one harmless extra burst; the other direction
    // pastes on top of residue and concatenates.
    expect(agentInputLineClearedSeededDraft(null, SEEDED)).toBe(false)
    expect(agentInputLineClearedSeededDraft('unparseable', SEEDED)).toBe(false)
  })

  it('reports not-cleared while the draft is still on the line', () => {
    expect(agentInputLineClearedSeededDraft(screenHoldingDraft, SEEDED)).toBe(false)
  })
})
