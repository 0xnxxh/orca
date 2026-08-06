// @vitest-environment happy-dom

/** A question card fully replaces the composer (`NativeChatView.tsx`,
 *  `{questionActive ? null : <NativeChatComposer/>}`) because the card supplies
 *  its own answer input. That swap unmounts the composer, so a Hangul preedit
 *  in flight when an AskUserQuestion card arrives is lost: the composer never
 *  receives `compositionend`, so the preedit is never committed to the draft,
 *  and the remounted textarea restores only the committed text via
 *  `defaultValue={draft}`.
 *
 *  THIS OWNS NO REPORTED ROW. It is not a regression guard for #12118 or
 *  STA-3219. Those reporters describe continuous flicker keyed to streaming
 *  token counters and elapsed timers, and those drivers provably do not remount
 *  the composer — `native-chat-composer-autogrow.test.tsx` holds node identity
 *  across 120 such rerenders. An AskUserQuestion card arrives once per question,
 *  which does not match that cadence. This is filed as a hazard guard for a real
 *  preedit-loss path found while searching for those rows' owner.
 *
 *  It characterizes CURRENT behavior, including the loss itself. Committing the
 *  preedit before the swap (or keeping the composer mounted) is a fix, not a
 *  regression — it will fail this file, and the expectations below should then
 *  be updated to the new contract rather than worked around.
 *
 *  The card owning its own input is by design; losing the in-flight composition
 *  is not. Geometry is deliberately unasserted: happy-dom has no layout engine. */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const PANE_KEY = 'tab-1:leaf-1'

const ASK_USER_QUESTION = JSON.stringify({
  questions: [
    {
      question: 'Tabs or spaces?',
      multiSelect: false,
      options: [{ label: 'Tabs' }, { label: 'Spaces' }]
    }
  ]
})

const { storeState } = vi.hoisted(() => ({
  storeState: {
    agentStatusByPaneKey: {
      'tab-1:leaf-1': { interactivePrompt: null as string | null, toolName: 'AskUserQuestion' }
    } as Record<string, Record<string, unknown>>,
    nativeChatLaunchPromptByTabId: {} as Record<string, unknown>,
    nativeChatLaunchDraftByTabId: {} as Record<string, unknown>,
    tabsByWorktree: {} as Record<string, unknown>,
    unifiedTabs: [] as unknown[],
    settings: { voice: { enabled: false, sttModel: null as string | null } },
    dictationState: null as string | null,
    clearNativeChatLaunchPrompt: () => {},
    clearNativeChatLaunchDraft: () => {}
  }
}))

vi.mock('../../store', () => ({
  useAppStore: Object.assign(
    (selector?: (state: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
    { getState: () => storeState }
  )
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

// Data sources and unrelated siblings are stubbed; the interactive card, the
// questionActive swap, and the composer itself stay real. The stubs return
// stable identities like the real memoized hooks do — fresh objects per render
// would retrigger identity-keyed effects and mask the behavior under test.
const { liveSession, interactiveSend } = vi.hoisted(() => ({
  liveSession: {
    messages: [{ id: 'm1', role: 'assistant', text: 'streaming', timestamp: 1 }],
    readPhase: 'ready',
    status: 'working'
  },
  interactiveSend: {
    sendAnswer: () => ({ settleAfterMs: 0, waitsForVerifiedDelivery: false }),
    sendRaw: () => {},
    cancelPending: () => {},
    cancel: () => {}
  }
}))

vi.mock('./use-native-chat-live-session', () => ({
  useNativeChatLiveSession: () => liveSession
}))
vi.mock('./use-native-chat-can-send', () => ({ useNativeChatCanSend: () => true }))
vi.mock('./use-native-chat-interactive-send', () => ({
  useNativeChatInteractiveSend: () => interactiveSend
}))
vi.mock('./NativeChatMessageList', () => ({
  NativeChatMessageList: () => <div data-testid="message-list" />
}))
vi.mock('./use-native-chat-context-menu', () => ({
  emptyNativeChatContextMenuActions: {},
  useNativeChatContextMenu: () => ({
    menu: null,
    onSelectionCapture: vi.fn(),
    onContextMenuCapture: vi.fn()
  })
}))
vi.mock('./use-native-chat-font-scale', () => ({
  useNativeChatFontScale: () => ({ scale: 1 })
}))
vi.mock('./NativeChatComposerActions', () => ({
  NativeChatComposerActions: () => <div data-testid="composer-actions" />
}))
vi.mock('./use-native-chat-session-options', () => ({
  useNativeChatSessionOptions: () => ({ surface: null, snapshot: [] })
}))

import NativeChatView from './NativeChatView'
import { clearNativeChatDraftCacheForTests } from './native-chat-draft-cache'

// Preload bridge surface the composer subscribes to on mount.
beforeAll(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ui: { onFileDrop: () => () => {} },
      shell: { pickAttachment: async () => [] }
    }
  })
})

afterEach(() => {
  cleanup()
  clearNativeChatDraftCacheForTests()
  storeState.agentStatusByPaneKey[PANE_KEY] = {
    interactivePrompt: null,
    toolName: 'AskUserQuestion'
  }
})

function view(): React.JSX.Element {
  return (
    <NativeChatView
      terminalTabId="tab-1"
      paneKey={PANE_KEY}
      targetPtyId="pty-1"
      launchAgent="claude"
      resolvedAgent="claude"
    />
  )
}

/** The composer textarea, or null while the question card owns the input region.
 *  Keyed on the placeholder so the card's own answer input is never mistaken
 *  for it. */
function composerTextarea(): HTMLTextAreaElement | null {
  return document.querySelector('textarea[placeholder]')
}

function setInteractivePrompt(prompt: string | null, rendered: ReturnType<typeof render>): void {
  act(() => {
    storeState.agentStatusByPaneKey[PANE_KEY].interactivePrompt = prompt
    rendered.rerender(view())
  })
}

describe('native chat question card vs an in-flight composition', () => {
  it('drops an active Hangul preedit but keeps the committed draft', () => {
    const rendered = render(view())
    const before = composerTextarea()
    expect(before).not.toBeNull()

    // Committed draft is "abc"; the user is now composing Hangul onto the end,
    // so "가" lives only in the browser-owned value, not in React state.
    fireEvent.change(before!, { target: { value: 'abc' } })
    fireEvent.compositionStart(before!)
    before!.value = 'abc가'

    // An AskUserQuestion card arrives mid-composition and takes the input region.
    setInteractivePrompt(ASK_USER_QUESTION, rendered)
    expect(composerTextarea()).toBeNull()
    expect(before!.isConnected).toBe(false)

    // The agent moves on and the prompt clears, so the composer comes back.
    setInteractivePrompt(null, rendered)
    const after = composerTextarea()
    expect(after).not.toBeNull()

    // The reporter-facing shape: a different node, committed text intact, and
    // the preedit gone because no compositionend ever reached the composer.
    expect(after).not.toBe(before)
    expect(after!.value).toBe('abc')
    expect(after!.value).not.toContain('가')
  })

  it('leaves an ordinary committed English draft unchanged through the same swap', () => {
    const rendered = render(view())
    const before = composerTextarea()
    expect(before).not.toBeNull()

    // No composition in flight, so there is nothing browser-owned to lose.
    fireEvent.change(before!, { target: { value: 'abc' } })

    setInteractivePrompt(ASK_USER_QUESTION, rendered)
    setInteractivePrompt(null, rendered)

    const after = composerTextarea()
    expect(after).not.toBeNull()
    expect(after!.value).toBe('abc')
  })
})
