import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import { TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS } from './terminal-live-hangul-mirror'
import { useTerminalLiveInputCommit } from './use-terminal-live-input-commit'

type TerminalLiveInputCommitHarness = {
  readonly clearLiveInput: () => void
  readonly captures: readonly string[]
  readonly handlers: ReturnType<typeof useTerminalLiveInputCommit<string>>
  readonly sent: readonly string[]
  readonly sentByHandle: readonly { readonly bytes: string; readonly handle: string }[]
  readonly setActiveHandle: (next: string) => void
  readonly setActiveSessionTabType: (next: string | undefined) => void
  readonly setConnected: (next: boolean) => void
  readonly setSendImplementation: (next: TerminalLiveInputSender | null) => void
  readonly setSendResult: (next: boolean) => void
  readonly unmount: () => void
}

type TerminalLiveInputCommitHarnessOptions = {
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
  sendResult = true
}: TerminalLiveInputCommitHarnessOptions = {}): TerminalLiveInputCommitHarness {
  let currentActiveHandle = 'terminal-a'
  const activeHandleRef: RefObject<string | null> = { current: currentActiveHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const captures: string[] = []
  const setLiveInputCapture = (text: string): void => {
    captures.push(text)
  }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandles = new Set(['terminal-a', 'terminal-b'])
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: new Set(liveInputTerminalHandles)
  }
  const sent: string[] = []
  const sentByHandle: { bytes: string; handle: string }[] = []
  let currentSendResult = sendResult
  let currentSendImplementation: TerminalLiveInputSender | null = null
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (handle, bytes) => {
      sent.push(bytes)
      sentByHandle.push({ bytes, handle })
      return currentSendImplementation
        ? currentSendImplementation(handle, bytes)
        : currentSendResult
    }
  }
  // Refs never re-render; only these variables re-run the hook's clear effects.
  let currentActiveSessionTabType: string | undefined = 'terminal'
  let currentConnected = true
  let handlers: ReturnType<typeof useTerminalLiveInputCommit<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLiveInputCommit({
      activeHandle: currentActiveHandle,
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
    clearLiveInput: (): void => {
      act(() => handlers?.clearPendingLiveInputCommit())
    },
    captures,
    get handlers() {
      if (!handlers) {
        throw new Error('terminal live input hook is not mounted')
      }
      return handlers
    },
    sent,
    sentByHandle,
    setActiveHandle: (next: string): void => {
      currentActiveHandle = next
      activeHandleRef.current = next
      act(() => {
        renderer?.update(createElement(Harness))
      })
    },
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
    setSendImplementation: (next: TerminalLiveInputSender | null): void => {
      currentSendImplementation = next
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
    changeLiveInput(handlers, 'a', false)
    changeLiveInput(handlers, 'ab', false)

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b']))
  })

  it('Given provisional marked text When its change arrives Then echoes without sending', () => {
    const { captures, handlers, sent } = createTerminalLiveInputCommitHarness()

    changeLiveInput(handlers, 'かな', true)

    expect(captures).toEqual(['かな'])
    expect(sent).toEqual([])
  })

  it('Given marked text When composition ends Then sends the committed text exactly once', async () => {
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, 'かな', true)

    changeLiveInput(handlers, 'かな', false)

    await vi.waitFor(() => expect(sent).toEqual(['かな']))
  })

  it('Given marked text When the active terminal switches Then clears it without sending', () => {
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, 'かな', true)

    harness.setActiveHandle('terminal-b')

    expect(harness.captures).toEqual(['かな', ''])
    expect(harness.sent).toEqual([])
  })

  it('Given a switch without a final event When fresh input and late old events arrive Then only sends fresh input', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    const oldHandlers = harness.handlers
    changeLiveInput(oldHandlers, 'かな', true)
    harness.setActiveHandle('terminal-b')

    changeLiveInput(harness.handlers, 'x', false)
    changeLiveInput(oldHandlers, '仮', true)
    changeLiveInput(oldHandlers, '仮名', false)

    await vi.waitFor(() =>
      expect(harness.sentByHandle).toEqual([{ bytes: 'x', handle: 'terminal-b' }])
    )
    expect(harness.captures).toEqual(['かな', '', 'x'])
  })

  it('Given a switch before any old input When late native events arrive Then rejects them', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    const oldHandlers = harness.handlers
    harness.setActiveHandle('terminal-b')
    changeLiveInput(harness.handlers, 'x', false)

    changeLiveInput(oldHandlers, 'かな', true)
    oldHandlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Tab' } })
    oldHandlers.handleLiveInputSubmit()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.sentByHandle).toEqual([{ bytes: 'x', handle: 'terminal-b' }])
    expect(harness.captures).toEqual(['x'])
  })

  it('Given reconnect without a final event When fresh input and late old events arrive Then only sends fresh input', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    const oldHandlers = harness.handlers
    changeLiveInput(oldHandlers, 'かな', true)
    harness.setConnected(false)
    harness.setConnected(true)

    changeLiveInput(harness.handlers, 'x', false)
    changeLiveInput(oldHandlers, '仮', true)
    changeLiveInput(oldHandlers, '仮名', false)

    await vi.waitFor(() => expect(harness.sent).toEqual(['x']))
    expect(harness.captures.slice(-2)).toEqual(['', 'x'])
  })

  it('Given toggle cleanup without a final event When fresh input and late old events arrive Then only sends fresh input', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    const oldHandlers = harness.handlers
    changeLiveInput(oldHandlers, 'かな', true)
    harness.clearLiveInput()

    changeLiveInput(harness.handlers, 'x', false)
    changeLiveInput(oldHandlers, '仮', true)
    changeLiveInput(oldHandlers, '仮名', false)

    await vi.waitFor(() => expect(harness.sent).toEqual(['x']))
    expect(harness.captures).toEqual(['かな', '', 'x'])
  })

  it('Given active marked text When an external send requests a flush Then defers it until commit', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, 'かな', true)
    let settled = false

    const flush = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => true)
    void flush.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(harness.sent).toEqual([])

    changeLiveInput(harness.handlers, '仮名', false)

    await expect(flush).resolves.toBe(true)
    expect(harness.sent).toEqual(['仮名'])
  })

  it('Given a newer composition starts during an older flush Then preserves and waits for it', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    let releaseFirstSend: (sent: boolean) => void = () => undefined
    const firstSend = new Promise<boolean>((resolve) => {
      releaseFirstSend = resolve
    })
    let sendCount = 0
    harness.setSendImplementation(async () => {
      sendCount += 1
      return sendCount === 1 ? firstSend : true
    })
    changeLiveInput(harness.handlers, 'かな', true)
    const flush = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => true)
    let flushSettled = false
    void flush.then(() => {
      flushSettled = true
    })
    changeLiveInput(harness.handlers, '仮名', false)
    await vi.waitFor(() => expect(harness.sent).toEqual(['仮名']))

    changeLiveInput(harness.handlers, '仮名か', true)
    releaseFirstSend(true)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(harness.captures.at(-1)).toBe('仮名か')
    expect(flushSettled).toBe(false)

    changeLiveInput(harness.handlers, '仮名漢字', false)

    await expect(flush).resolves.toBe(true)
    expect(harness.sent).toEqual(['仮名', '漢字'])
    expect(harness.captures.at(-1)).toBe('')
  })

  it('Given flush requests span successive compositions Then resolves them in request order', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    let releaseFirstSend: (sent: boolean) => void = () => undefined
    const firstSend = new Promise<boolean>((resolve) => {
      releaseFirstSend = resolve
    })
    let sendCount = 0
    harness.setSendImplementation(async () => {
      sendCount += 1
      return sendCount === 1 ? firstSend : true
    })
    const settled: string[] = []
    changeLiveInput(harness.handlers, 'かな', true)
    const firstFlush = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => true)
    void firstFlush.then(() => settled.push('first'))
    changeLiveInput(harness.handlers, '仮名', false)
    await vi.waitFor(() => expect(harness.sent).toEqual(['仮名']))

    changeLiveInput(harness.handlers, '仮名か', true)
    const secondFlush = harness.handlers.runTerminalLiveExternalInput(
      'terminal-a',
      async () => true
    )
    void secondFlush.then(() => settled.push('second'))
    changeLiveInput(harness.handlers, '仮名漢字', false)
    releaseFirstSend(true)

    await expect(Promise.all([firstFlush, secondFlush])).resolves.toEqual([true, true])
    expect(harness.sent).toEqual(['仮名', '漢字'])
    expect(settled).toEqual(['first', 'second'])
  })

  it('Given queued external sends When the first operation is pending Then holds the second operation', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    let releaseFirst: (sent: boolean) => void = () => undefined
    const firstPending = new Promise<boolean>((resolve) => {
      releaseFirst = resolve
    })
    const sends: string[] = []

    const first = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => {
      sends.push('first-start')
      const sent = await firstPending
      sends.push('first-end')
      return sent
    })
    const second = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => {
      sends.push('second')
      return true
    })

    await vi.waitFor(() => expect(sends).toEqual(['first-start']))
    releaseFirst(true)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(sends).toEqual(['first-start', 'first-end', 'second'])
  })

  it('Given a queued send predates reconnect When its turn arrives Then cancels the stale operation', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    let releaseFirst: (sent: boolean) => void = () => undefined
    const firstPending = new Promise<boolean>((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted = false
    const secondSend = vi.fn(async () => true)
    const first = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => {
      firstStarted = true
      return firstPending
    })
    const second = harness.handlers.runTerminalLiveExternalInput('terminal-a', secondSend)
    await vi.waitFor(() => expect(firstStarted).toBe(true))

    harness.setConnected(false)
    harness.setConnected(true)
    releaseFirst(true)

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
    expect(secondSend).not.toHaveBeenCalled()
  })

  it('Given an old flush is invalidated Then it cannot clear new fallback input', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    let releaseOldSend: (sent: boolean) => void = () => undefined
    const oldSend = new Promise<boolean>((resolve) => {
      releaseOldSend = resolve
    })
    let sendCount = 0
    harness.setSendImplementation(async () => {
      sendCount += 1
      return sendCount === 1 ? oldSend : true
    })
    changeLiveInput(harness.handlers, 'かな', true)
    const oldFlush = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => true)
    changeLiveInput(harness.handlers, '仮名', false)
    await vi.waitFor(() => expect(harness.sent).toEqual(['仮名']))

    harness.setActiveHandle('terminal-b')
    changeLiveInput(harness.handlers, '한')
    releaseOldSend(true)

    await expect(oldFlush).resolves.toBe(false)
    expect(harness.captures.at(-1)).toBe('한')
    await expect(
      harness.handlers.runTerminalLiveExternalInput('terminal-b', async () => true)
    ).resolves.toBe(true)
    expect(harness.sentByHandle).toEqual([
      { bytes: '仮名', handle: 'terminal-a' },
      { bytes: '한', handle: 'terminal-b' }
    ])
  })

  it('Given a deferred external send When the terminal switches Then cancels the original target', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, 'かな', true)
    const flush = harness.handlers.runTerminalLiveExternalInput('terminal-a', async () => true)

    harness.setActiveHandle('terminal-b')

    await expect(flush).resolves.toBe(false)
    expect(harness.sent).toEqual([])
  })

  it('Given active marked text When an accessory key is pressed Then suppresses it until commit', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, 'かな', true)

    await expect(
      harness.handlers.handleLiveInputAccessoryBytes({ bytes: '\x1b' })
    ).resolves.toEqual({ kind: 'suppress-raw' })

    changeLiveInput(harness.handlers, '仮名', false)
    await vi.waitFor(() => expect(harness.sent).toEqual(['仮名']))
    await expect(
      harness.handlers.handleLiveInputAccessoryBytes({ bytes: '\x1b' })
    ).resolves.toEqual({ kind: 'allow-raw' })
  })

  it('Given a switch clears marked text When controls target the new terminal Then allows them', async () => {
    const harness = createTerminalLiveInputCommitHarness()
    changeLiveInput(harness.handlers, 'かな', true)
    harness.setActiveHandle('terminal-b')

    await expect(
      harness.handlers.runTerminalLiveExternalInput('terminal-b', async () => true)
    ).resolves.toBe(true)
    await expect(
      harness.handlers.handleLiveInputAccessoryBytes({ bytes: '\x1b' })
    ).resolves.toEqual({ kind: 'allow-raw' })
  })

  it('Given active composition When native control events arrive Then keeps them inside the IME', () => {
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, 'かな', true)

    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Tab' } })
    handlers.handleLiveInputSubmit()

    expect(sent).toEqual([])
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
    const flushed = await handlers.runTerminalLiveExternalInput('terminal-a', async () => true)

    // Then
    expect(flushed).toBe(true)
    expect(sent).toEqual(['한'])
  })

  it('Given pending text cannot be sent When an external terminal send is requested Then reports failure', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness({ sendResult: false })
    changeLiveInput(handlers, '한')

    // When
    const flushed = await handlers.runTerminalLiveExternalInput('terminal-a', async () => true)

    // Then
    expect(flushed).toBe(false)
    expect(sent).toEqual(['한'])
  })

  it('Given a change event without composition state When it arrives Then uses the existing mirror path', async () => {
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
    const { handlers, sent, setActiveSessionTabType } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When: the mobile tab list momentarily yields no active tab object
    setActiveSessionTabType(undefined)
    handlers.handleLiveInputSubmit()

    // Then: an unknown tab type is not "left the terminal", so pending still flushes
    await vi.waitFor(() => expect(sent).toEqual(['한', '\r']))
  })

  it('Given Hangul pending When the tab genuinely changes to non-terminal Then clears the composition state', async () => {
    // Given: '한' held while the active tab is still a terminal
    const { handlers, sent, setActiveSessionTabType } = createTerminalLiveInputCommitHarness()
    changeLiveInput(handlers, '한')

    // When: the active tab actually becomes a non-terminal (chat) tab
    setActiveSessionTabType('chat')
    handlers.handleLiveInputSubmit()

    // Then: pending was dropped and the old terminal handler cannot submit from chat.
    expect(sent).toEqual([])
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
