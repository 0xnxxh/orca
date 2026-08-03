import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import { TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS } from './terminal-live-hangul-mirror'
import { useTerminalLiveInputCommit } from './use-terminal-live-input-commit'

type TerminalLiveInputCommitHarness = {
  readonly captures: readonly string[]
  readonly handlers: ReturnType<typeof useTerminalLiveInputCommit<string>>
  readonly sent: readonly string[]
  readonly setActiveSessionTabType: (next: string | undefined) => void
  readonly setConnected: (next: boolean) => void
  readonly setSendResult: (next: boolean) => void
  readonly unmount: () => void
}

type TerminalLiveInputCommitHarnessOptions = {
  readonly sendImplementation?: TerminalLiveInputSender
  readonly sendResult?: boolean
}

function suppressReactTestRendererDeprecationWarning(): () => void {
  const originalConsoleError = console.error
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    const firstArg = args[0]
    if (typeof firstArg === 'string' && firstArg.includes('react-test-renderer is deprecated')) {
      return
    }
    originalConsoleError(...args)
  })
  return () => consoleErrorSpy.mockRestore()
}

function createTerminalLiveInputCommitHarness({
  sendImplementation,
  sendResult = true
}: TerminalLiveInputCommitHarnessOptions = {}): TerminalLiveInputCommitHarness {
  const activeHandle = 'terminal-a'
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const captures: string[] = []
  const setLiveInputCapture = (text: string): void => {
    captures.push(text)
  }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandles = new Set([activeHandle])
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set([activeHandle])
  }
  const sent: string[] = []
  let currentSendResult = sendResult
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      return sendImplementation ? sendImplementation(activeHandle, bytes) : currentSendResult
    }
  }
  // Refs never re-render; only these variables re-run the hook's clear effects.
  let currentActiveSessionTabType: string | undefined = 'terminal'
  let currentConnected = true
  let handlers: ReturnType<typeof useTerminalLiveInputCommit<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLiveInputCommit({
      activeHandle,
      activeHandleRef,
      activeSessionTabType: currentActiveSessionTabType,
      activeSessionTabTypeRef,
      connected: currentConnected,
      liveInputRef,
      liveInputTerminalHandles,
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live input hook did not render')
  }

  return {
    captures,
    get handlers() {
      if (!handlers) {
        throw new Error('terminal live input hook is not mounted')
      }
      return handlers
    },
    sent,
    setActiveSessionTabType: (next: string | undefined): void => {
      currentActiveSessionTabType = next
      // Ref and prop derive from the same activeSessionTab in the real route, so
      // they go null together during tab-list lag — keep the harness coupled.
      activeSessionTabTypeRef.current = next ?? null
      act(() => {
        renderer?.update(createElement(Harness))
      })
    },
    setConnected: (next: boolean): void => {
      currentConnected = next
      act(() => {
        renderer?.update(createElement(Harness))
      })
    },
    setSendResult: (next: boolean): void => {
      currentSendResult = next
    },
    unmount: () => {
      act(() => renderer?.unmount())
    }
  }
}

function changeLiveInput(
  handlers: TerminalLiveInputCommitHarness['handlers'],
  text: string,
  isComposing?: boolean
): void {
  handlers.handleLiveInputChange({ nativeEvent: { isComposing, text } })
}

describe('terminal live input commit hook', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Given Hangul composition When steps arrive Then streams the stable prefix and never leaks jamo', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When: ㅎ→하→한→한ㄱ→한그→한글 (no settle pause between steps)
    for (const fieldText of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) {
      changeLiveInput(handlers, fieldText)
      await vi.advanceTimersByTimeAsync(50)
    }

    // Then: only the stable prefix went out; the trailing syllable is held
    await vi.waitFor(() => expect(sent).toEqual(['한']))
  })

  it('Given a held syllable When the settle timer elapses Then commits it to the terminal', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한']))
  })

  it('Given a timer-committed syllable When composition continues Then corrects with DEL and recommits', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '하')
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)
    await vi.waitFor(() => expect(sent).toEqual(['하']))

    // When
    changeLiveInput(handlers, '한')
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['하', '\x7f', '한']))
  })

  it('Given Hangul pending text When submit is requested Then sends composed text before carriage return', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    handlers.handleLiveInputSubmit()

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한', '\r']))
  })

  it('Given no pending text When submit is requested Then sends only carriage return', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    handlers.handleLiveInputSubmit()

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['\r']))
  })

  it('Given a rejected held-text send When submit is requested Then suppresses the carriage return', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness({ sendResult: false })
    changeLiveInput(handlers, '한')

    // When
    handlers.handleLiveInputSubmit()
    await Promise.resolve()
    await Promise.resolve()

    // Then: the held commit went out but was not accepted, so no \r follows
    await vi.waitFor(() => expect(sent).toEqual(['한']))
  })

  it('Given ASCII typing When changes arrive Then mirrors immediately', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    changeLiveInput(handlers, 'a')
    changeLiveInput(handlers, 'ab')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b']))
  })

  it('Given iOS marked text When kana changes Then sends only the committed text', async () => {
    // Given
    const { captures, handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    changeLiveInput(handlers, 'k', true)
    changeLiveInput(handlers, 'か', true)

    // Then
    expect(captures).toEqual(['k', 'か'])
    expect(sent).toEqual([])

    // When
    changeLiveInput(handlers, 'か', false)

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['か']))
  })

  it('Given marked text When an external send starts Then waits for the committed text', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, 'か', true)

    // When
    const flush = handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')
    let settled = false
    void flush.then(() => {
      settled = true
    })
    await Promise.resolve()

    // Then
    expect(settled).toBe(false)

    // When
    changeLiveInput(handlers, 'か', false)

    // Then
    await expect(flush).resolves.toBe(true)
    expect(sent).toEqual(['か'])
  })

  it('Given marked text When terminal controls are pressed Then suppresses them', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, 'か', true)

    // When
    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Tab' } })
    handlers.handleLiveInputSubmit()
    const accessoryResult = await handlers.handleLiveInputAccessoryBytes({ bytes: '\t' })

    // Then
    expect(accessoryResult).toEqual({ kind: 'suppress-raw' })
    expect(sent).toEqual([])
  })

  it('Given an external send waiting on marked text When the connection resets Then cancels it', async () => {
    // Given
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, 'か', true)
    const flush = harness.handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')

    // When
    harness.setConnected(false)

    // Then
    await expect(flush).resolves.toBe(false)
    expect(harness.sent).toEqual([])
  })

  it('Given a second composition starts during a flush When the first send resolves Then preserves and flushes the new Kana first', async () => {
    // Given
    let resolveSend: (sent: boolean) => void = () => undefined
    const pendingSend = new Promise<boolean>((resolve) => {
      resolveSend = resolve
    })
    const harness = createTerminalLiveInputCommitHarness({
      sendImplementation: async () => pendingSend
    })
    changeLiveInput(harness.handlers, 'か', true)
    changeLiveInput(harness.handlers, 'か', false)
    await vi.waitFor(() => expect(harness.sent).toEqual(['か']))
    const flush = harness.handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')

    // When
    changeLiveInput(harness.handlers, 'かに', true)
    resolveSend(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Then
    expect(harness.captures.at(-1)).toBe('かに')
    let flushSettled = false
    void flush.then(() => {
      flushSettled = true
    })
    await Promise.resolve()
    expect(flushSettled).toBe(false)

    // When
    changeLiveInput(harness.handlers, 'かに', false)

    // Then
    await expect(flush).resolves.toBe(true)
    expect(harness.sent).toEqual(['か', 'に'])
  })

  it('Given iOS smart-dash text When the change arrives Then the capture echoes the raw field text and the PTY gets normalized bytes', async () => {
    // Given
    const { captures, handlers, sent } = createTerminalLiveInputCommitHarness()

    // When: iOS smart punctuation rewrote "--" into an en dash inside the field
    changeLiveInput(handlers, 'a–')

    // Then: writing "a--" back into the controlled value would kill an active
    // iOS dictation/IME session, so the capture must keep what iOS produced
    expect(captures).toEqual(['a–'])
    await vi.waitFor(() => expect(sent).toEqual(['a--']))
  })

  it('Given dictation-style hypothesis revisions When changes arrive Then the field is never rewritten and the PTY converges', async () => {
    // Given
    const { captures, handlers, sent } = createTerminalLiveInputCommitHarness()

    // When: iOS dictation replaces its hypothesis as recognition refines
    changeLiveInput(handlers, 'high')
    changeLiveInput(handlers, 'hi there')

    // Then: captures only echo the field; the mirror repairs the PTY with DELs
    expect(captures).toEqual(['high', 'hi there'])
    await vi.waitFor(() => expect(sent).toEqual(['high', '\x7f\x7f there']))
  })

  it('Given a trailing space after Hangul When the change arrives Then the space commits the held syllable', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    changeLiveInput(handlers, '한 ')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한 ']))
  })

  it('Given Hangul pending text When an external terminal send is requested Then flushes composed text first', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    const flushed = await handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')

    // Then
    expect(flushed).toBe(true)
    expect(sent).toEqual(['한'])
  })

  it('Given pending text cannot be sent When an external terminal send is requested Then reports failure', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness({ sendResult: false })
    changeLiveInput(handlers, '한')

    // When
    const flushed = await handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')

    // Then
    expect(flushed).toBe(false)
    expect(sent).toEqual(['한'])
  })

  it('Given non-Hangul IME text When changes arrive Then mirrors immediately without a settle window', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    changeLiveInput(handlers, '你好')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['你好']))
  })

  it('Given a held syllable When the hook unmounts Then cancels the settle timer', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent, unmount } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    unmount()
    await vi.advanceTimersByTimeAsync(1_000)

    // Then
    expect(sent).toEqual([])
  })

  it('Given Backspace with field text When the key arrives Then edits locally without terminal bytes', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Backspace' } })

    // Then
    await vi.waitFor(() => expect(sent).toEqual([]))
  })

  it('Given Tab with a held syllable When the key arrives Then commits the syllable before the tab bytes', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When
    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Tab' } })

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한', '\t']))
  })

  it('Given Hangul pending When the tab type lags to undefined Then keeps the composition state', async () => {
    // Given: '한' held while the active tab is still a terminal
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, '한')

    // When: the mobile tab list momentarily yields no active tab object
    harness.setActiveSessionTabType(undefined)
    harness.handlers.handleLiveInputSubmit()

    // Then: an unknown tab type is not "left the terminal", so pending still flushes
    await vi.waitFor(() => expect(harness.sent).toEqual(['한', '\r']))
  })

  it('Given Hangul pending When the tab genuinely changes to non-terminal Then clears the composition state', async () => {
    // Given: '한' held while the active tab is still a terminal
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, '한')

    // When: the active tab actually becomes a non-terminal (chat) tab
    harness.setActiveSessionTabType('chat')
    harness.handlers.handleLiveInputSubmit()

    // Then: pending was dropped, so submit sends only the carriage return
    await vi.waitFor(() => expect(harness.sent).toEqual(['\r']))
  })

  it('Given bytes lost in a silent stall When the disconnect is detected Then the first post-recovery send carries no stale fragment or phantom erases', async () => {
    // Given: a stalled link — the mirror sends but the PTY never accepts (#6713 second defect)
    const harness = createTerminalLiveInputCommitHarness({ sendResult: false })
    changeLiveInput(harness.handlers, 'XYZZY')
    await vi.waitFor(() => expect(harness.sent).toEqual(['XYZZY']))

    // When: the outage is finally detected, then the link recovers
    harness.setConnected(false)
    harness.setSendResult(true)
    harness.setConnected(true)

    // Then: the capture was wiped, and fresh typing sends verbatim bytes — not
    // 'XYZZY…' replayed and not DELs erasing PTY chars that never arrived
    expect(harness.captures.at(-1)).toBe('')
    const sentBeforeRecovery = harness.sent.length
    changeLiveInput(harness.handlers, 'echo CLEANLINE')
    await vi.waitFor(() =>
      expect(harness.sent.slice(sentBeforeRecovery)).toEqual(['echo CLEANLINE'])
    )
  })

  it('Given a held syllable during an outage When the disconnect is detected Then the settle timer cannot commit it later', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent, setConnected } = createTerminalLiveInputCommitHarness({
      sendResult: false
    })
    changeLiveInput(handlers, '한')

    // When
    setConnected(false)
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)

    // Then: the outage cleared the held text before the timer could send it
    expect(sent).toEqual([])
  })
})
