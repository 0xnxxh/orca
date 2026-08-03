import { createElement, type RefObject } from 'react'
import { act, create } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import { useTerminalLiveInputCommit } from './use-terminal-live-input-commit'

type Handlers = ReturnType<typeof useTerminalLiveInputCommit<string>>

type RecordedChange = {
  readonly text: string
  readonly isComposing: boolean
  readonly replacementText: string
  readonly start: number
  readonly end: number
}

const RECORDED_IOS_KANA_TRACE: readonly RecordedChange[] = [
  { text: 'あ', isComposing: true, replacementText: 'あ', start: 0, end: 0 },
  { text: 'あ', isComposing: true, replacementText: 'あ', start: 0, end: 1 },
  { text: 'あ', isComposing: false, replacementText: 'あ', start: 0, end: 1 },
  { text: 'あき', isComposing: true, replacementText: 'き', start: 1, end: 1 },
  { text: 'あき', isComposing: true, replacementText: 'き', start: 1, end: 2 },
  { text: 'あき', isComposing: false, replacementText: 'き', start: 1, end: 2 },
  { text: 'あきか', isComposing: true, replacementText: 'か', start: 2, end: 2 },
  { text: 'あきかな', isComposing: true, replacementText: 'な', start: 3, end: 3 },
  { text: 'あきカナ', isComposing: true, replacementText: 'カナ', start: 2, end: 4 },
  { text: 'あきカナ', isComposing: false, replacementText: 'カナ', start: 2, end: 4 },
  { text: 'あきカナさ', isComposing: true, replacementText: 'さ', start: 4, end: 4 },
  { text: 'あきカナ', isComposing: false, replacementText: '', start: 4, end: 5 }
]

const IOS_ROMAJI_RECORDED_PREFIX = 'あきカナたあbcabc'
const RECORDED_IOS_ROMAJI_TRACE: readonly RecordedChange[] = [
  {
    text: `${IOS_ROMAJI_RECORDED_PREFIX}k`,
    isComposing: true,
    replacementText: 'k',
    start: 11,
    end: 11
  },
  {
    text: `${IOS_ROMAJI_RECORDED_PREFIX}か`,
    isComposing: true,
    replacementText: 'a',
    start: 12,
    end: 12
  },
  {
    text: `${IOS_ROMAJI_RECORDED_PREFIX}かn`,
    isComposing: true,
    replacementText: 'n',
    start: 12,
    end: 12
  },
  {
    text: `${IOS_ROMAJI_RECORDED_PREFIX}かな`,
    isComposing: true,
    replacementText: 'a',
    start: 13,
    end: 13
  },
  {
    text: `${IOS_ROMAJI_RECORDED_PREFIX}かな`,
    isComposing: true,
    replacementText: 'かな',
    start: 11,
    end: 13
  },
  {
    text: `${IOS_ROMAJI_RECORDED_PREFIX}かな`,
    isComposing: false,
    replacementText: 'かな',
    start: 11,
    end: 13
  }
]

function createHarness(): {
  readonly captures: string[]
  readonly handlers: Handlers
  readonly sent: string[]
} {
  const activeHandle = 'terminal-a'
  const captures: string[] = []
  const sent: string[] = []
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const liveInputTerminalHandles = new Set([activeHandle])
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (_handle, bytes) => {
      sent.push(bytes)
      return true
    }
  }
  const liveInputRef = {
    current: { setNativeProps: vi.fn() } as unknown as TextInput
  }
  let handlers: Handlers | null = null

  function Harness(): null {
    handlers = useTerminalLiveInputCommit({
      activeHandle,
      activeHandleRef,
      activeSessionTabType: 'terminal',
      activeSessionTabTypeRef,
      connected: true,
      liveInputRef,
      liveInputTerminalHandles,
      liveInputTerminalHandlesRef: { current: liveInputTerminalHandles },
      sendLiveTerminalInputRef,
      setLiveInputCapture: (text) => captures.push(text)
    })
    return null
  }

  const originalConsoleError = console.error
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
      originalConsoleError(...args)
    }
  })
  try {
    act(() => {
      create(createElement(Harness))
    })
  } finally {
    consoleError.mockRestore()
  }
  if (!handlers) {
    throw new Error('terminal live input hook did not render')
  }
  return { captures, handlers, sent }
}

function change(handlers: Handlers, event: RecordedChange): void {
  handlers.handleLiveInputChange({
    nativeEvent: {
      text: event.text,
      isComposing: event.isComposing,
      replacementText: event.replacementText,
      replacementRange: { start: event.start, end: event.end }
    }
  })
}

function replay(handlers: Handlers, trace: readonly RecordedChange[]): void {
  for (const event of trace) {
    change(handlers, event)
  }
}

describe('terminal live input commit hook', () => {
  it('keeps the recorded Pinyin preedit native and sends only its candidate commit', async () => {
    const { captures, handlers, sent } = createHarness()

    const preedit = [
      { text: 'z', replacementText: 'z', start: 0 },
      { text: 'zh', replacementText: 'h', start: 1 },
      { text: 'zho', replacementText: 'o', start: 2 },
      { text: 'zhon', replacementText: 'n', start: 3 },
      { text: 'zhong', replacementText: 'g', start: 4 }
    ]
    for (const event of preedit) {
      change(handlers, {
        ...event,
        isComposing: true,
        end: event.start
      })
    }
    expect(sent).toEqual([])

    change(handlers, {
      text: '中',
      isComposing: true,
      replacementText: '中',
      start: 0,
      end: 5
    })
    expect(sent).toEqual([])

    change(handlers, {
      text: '中',
      isComposing: false,
      replacementText: '中',
      start: 0,
      end: 5
    })

    await vi.waitFor(() => expect(sent).toEqual(['中']))
    expect(captures).toEqual(['z', 'zh', 'zho', 'zhon', 'zhong', '中', '中'])
  })

  it('keeps ordinary non-IME typing unchanged', async () => {
    const { handlers, sent } = createHarness()
    change(handlers, {
      text: 'a',
      isComposing: false,
      replacementText: 'a',
      start: 0,
      end: 0
    })
    change(handlers, {
      text: 'ab',
      isComposing: false,
      replacementText: 'b',
      start: 1,
      end: 1
    })
    change(handlers, {
      text: 'abc',
      isComposing: false,
      replacementText: 'c',
      start: 2,
      end: 2
    })
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b', 'c']))
  })

  it('replays the recorded iOS Kana tap, flick, candidate, and cancellation trace', async () => {
    const { handlers, sent } = createHarness()

    change(handlers, RECORDED_IOS_KANA_TRACE[0])
    await expect(handlers.handleLiveInputAccessoryBytes({ bytes: '\r' })).resolves.toEqual({
      kind: 'suppress-raw'
    })
    replay(handlers, RECORDED_IOS_KANA_TRACE.slice(1))

    await vi.waitFor(() => expect(sent).toEqual(['あ', 'き', 'カナ']))
  })

  it('replays the recorded iOS Japanese Romaji candidate trace', async () => {
    const { handlers, sent } = createHarness()
    change(handlers, {
      text: IOS_ROMAJI_RECORDED_PREFIX,
      isComposing: false,
      replacementText: IOS_ROMAJI_RECORDED_PREFIX,
      start: 0,
      end: 0
    })
    await vi.waitFor(() => expect(sent).toEqual([IOS_ROMAJI_RECORDED_PREFIX]))
    sent.length = 0

    replay(handlers, RECORDED_IOS_ROMAJI_TRACE)

    await vi.waitFor(() => expect(sent).toEqual(['かな']))
  })

  it('emits nothing for the recorded Pinyin cancellation trace', () => {
    const { handlers, sent } = createHarness()
    const changes = [
      { text: 'z', isComposing: true, replacementText: 'z', start: 0, end: 0 },
      { text: 'zh', isComposing: true, replacementText: 'h', start: 1, end: 1 },
      { text: 'z', isComposing: true, replacementText: '', start: 1, end: 2 },
      { text: '', isComposing: false, replacementText: '', start: 0, end: 1 }
    ]
    for (const event of changes) {
      change(handlers, event)
    }
    expect(sent).toEqual([])
  })

  it('suppresses submit and accessory controls until native composition ends', async () => {
    const { handlers, sent } = createHarness()
    change(handlers, {
      text: 'zhong',
      isComposing: true,
      replacementText: 'zhong',
      start: 0,
      end: 0
    })

    handlers.handleLiveInputSubmit()
    await expect(handlers.handleLiveInputAccessoryBytes({ bytes: '\t' })).resolves.toEqual({
      kind: 'suppress-raw'
    })
    expect(sent).toEqual([])
  })

  it('emits nothing when native replacement evidence is absent', () => {
    const { handlers, sent } = createHarness()
    handlers.handleLiveInputChange({
      nativeEvent: {
        text: 'mutable snapshot'
      } as never
    })
    expect(sent).toEqual([])
  })
})
