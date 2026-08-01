import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  resetMobileNativeChatStopLeasesForTests,
  waitForMobileNativeChatStopLease
} from './mobile-native-chat-stop-lease'

const answerAskWrite = vi.fn(async () => true)
const cancelPendingAnswer = vi.fn()
const cancelAskWrite = vi.fn(async () => true)
const permissionWrite = vi.fn(async () => true)
const messageWrite = vi.fn(async () => true)
const messageWriteWithOutcome = vi.fn(async () => 'accepted' as const)
const questionAnswerWrite = vi.fn(async () => true)

vi.mock('./use-mobile-session-view-mode', () => ({
  useMobileSessionViewMode: () => ({ isTabChatView: () => true, toggleTabChatView: vi.fn() })
}))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({ messages: [], status: 'ready', transcriptLoading: false })
}))
vi.mock('./use-mobile-native-chat-drafts', () => ({
  useMobileNativeChatDrafts: () => ({
    composerText: '',
    setComposerText: vi.fn(),
    pending: [],
    captureSendOrigin: vi.fn(),
    readSeededLaunchDraft: () => null,
    readSeededLaunchDraftSeed: () => null,
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(),
    holdUnconfirmedSend: vi.fn()
  })
}))
vi.mock('./use-mobile-native-chat-prompts', () => ({
  useMobileNativeChatPrompts: () => ({ permission: null, question: null, ask: null })
}))
vi.mock('./use-mobile-native-chat-answer-send', () => ({
  useMobileNativeChatAnswerSend: () => ({
    answerAsk: answerAskWrite,
    cancelPending: cancelPendingAnswer
  })
}))
vi.mock('./use-mobile-native-chat-cancel-ask', () => ({
  useMobileNativeChatCancelAsk: () => cancelAskWrite
}))
vi.mock('./mobile-native-chat-permission-send', () => ({
  useMobileNativeChatPermissionSend: () => permissionWrite
}))
vi.mock('./use-mobile-native-chat-message-send', () => ({
  useMobileNativeChatMessageSend: () => ({
    send: messageWrite,
    sendWithOutcome: messageWriteWithOutcome,
    answerQuestion: questionAnswerWrite
  })
}))
vi.mock('./use-mobile-native-chat-file-search', () => ({
  useMobileNativeChatFileSearch: () => ({ nativeChatFilePaths: [], loadNativeChatFiles: vi.fn() })
}))

import {
  useMobileNativeChatController,
  type MobileNativeChatController
} from './use-mobile-native-chat-controller'

const acceptedResponse = {
  id: 'send',
  ok: true as const,
  result: { send: { accepted: true } },
  _meta: { runtimeId: 'runtime-1' }
}

describe('useMobileNativeChatController Stop interleaving', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatController | null = null
  let resolveCleanup!: (response: unknown) => void
  let cleanupPromise!: Promise<unknown>
  const handleRef = { current: 'terminal-1' as string | null }
  const sendRequest = vi.fn()
  const onSendError = vi.fn()

  function Harness({ sessionId }: { sessionId: string }): null {
    controller = useMobileNativeChatController({
      client: { sendRequest } as unknown as RpcClient,
      connState: 'connected',
      hostId: 'host-1',
      worktreeId: 'worktree-1',
      activeSessionTab: {
        type: 'terminal',
        launchAgent: 'codex',
        agentStatus: {
          state: 'working',
          agentType: 'codex',
          providerSession: { id: sessionId }
        }
      } as never,
      activeSessionTabId: 'tab-1',
      activeHandleRef: handleRef,
      deviceTokenRef: { current: 'mobile-1' },
      nativeChatTranscriptIsLocalReadable: true,
      nativeChatInputLeaseReady: true,
      onSendError,
      onSendResolved: vi.fn()
    })
    return null
  }

  async function render(sessionId: string): Promise<void> {
    await act(async () => {
      const element = createElement(Harness, { sessionId })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }

  async function startStop(): Promise<void> {
    act(() => controller?.handleNativeChatStop())
    await act(async () => vi.advanceTimersByTimeAsync(160))
    expect(sendRequest.mock.calls.at(-1)?.[1]).toMatchObject({ text: '/stop', enter: true })
  }

  async function settleCleanup(accepted = true): Promise<void> {
    await act(async () => {
      resolveCleanup({
        ...acceptedResponse,
        result: { send: { accepted } }
      })
      await Promise.resolve()
    })
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    resetMobileNativeChatStopLeasesForTests()
    handleRef.current = 'terminal-1'
    cleanupPromise = new Promise((resolve) => {
      resolveCleanup = resolve
    })
    sendRequest.mockImplementation((_method: string, params: { text?: string }) =>
      params.text === '/stop' ? cleanupPromise : Promise.resolve(acceptedResponse)
    )
    const original = console.error
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
        return
      }
      original(...args)
    })
    try {
      await render('session-1')
    } finally {
      spy.mockRestore()
    }
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
    resetMobileNativeChatStopLeasesForTests()
    vi.useRealTimers()
  })

  it('queues every controller writer and ignores duplicate Stop taps until cleanup settles', async () => {
    await startStop()
    const sends = [
      controller!.handleNativeChatSend('message'),
      controller!.handleNativeChatSendWithOutcome('image body', ['file:///image.jpg']),
      controller!.handleNativeChatAnswerAsk({} as never, []),
      controller!.handleNativeChatCancelAsk(),
      controller!.handleNativeChatRespondPermission('1'),
      controller!.handleNativeChatQuestionAnswer('answer')
    ]
    const imageWrite = vi.fn()
    const imageBarrier = controller!.beforeNativeChatWrite().then((allowed) => {
      if (allowed) {
        imageWrite()
      }
      return allowed
    })
    act(() => {
      controller?.handleNativeChatStop()
      controller?.handleNativeChatStop()
    })
    await Promise.resolve()

    expect(answerAskWrite).not.toHaveBeenCalled()
    expect(cancelAskWrite).not.toHaveBeenCalled()
    expect(permissionWrite).not.toHaveBeenCalled()
    expect(messageWrite).not.toHaveBeenCalled()
    expect(messageWriteWithOutcome).not.toHaveBeenCalled()
    expect(questionAnswerWrite).not.toHaveBeenCalled()
    expect(imageWrite).not.toHaveBeenCalled()
    expect(cancelPendingAnswer).toHaveBeenCalledOnce()
    expect(sendRequest.mock.calls.filter(([, params]) => params.text === '/stop')).toHaveLength(1)

    await settleCleanup()
    await Promise.all([...sends, imageBarrier])
    expect(answerAskWrite).toHaveBeenCalledOnce()
    expect(cancelAskWrite).toHaveBeenCalledOnce()
    expect(permissionWrite).toHaveBeenCalledOnce()
    expect(messageWrite).toHaveBeenCalledOnce()
    expect(messageWriteWithOutcome).toHaveBeenCalledOnce()
    expect(questionAnswerWrite).toHaveBeenCalledOnce()
    expect(imageWrite).toHaveBeenCalledOnce()
  })

  it('drops a queued stale-session write while allowing the replacement route', async () => {
    await startStop()
    const previousController = controller!
    const staleSend = previousController.handleNativeChatSend('stale')

    await render('session-2')
    const currentSend = controller!.handleNativeChatSend('current')
    await settleCleanup()

    await expect(staleSend).resolves.toBe(false)
    await expect(currentSend).resolves.toBe(true)
    expect(messageWrite).toHaveBeenCalledOnce()
    expect(messageWrite).toHaveBeenCalledWith('current', undefined)
  })

  it('credits Stop waiting back to a queued image send budget', async () => {
    await startStop()
    const deadline = Date.now() + 10_000
    const queuedSend = controller!.handleNativeChatSendWithOutcome(
      'image body',
      ['file:///image.jpg'],
      deadline
    )

    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    await settleCleanup()

    await expect(queuedSend).resolves.toBe('accepted')
    expect(messageWriteWithOutcome).toHaveBeenCalledWith(
      'image body',
      ['file:///image.jpg'],
      deadline + 4_000
    )
  })

  it('drops queued writes on unmount and releases the terminal lease', async () => {
    await startStop()
    const queuedSend = controller!.handleNativeChatSend('stale')
    const released = waitForMobileNativeChatStopLease('terminal-1')

    act(() => renderer?.unmount())
    renderer = null
    await settleCleanup()

    await expect(queuedSend).resolves.toBe(false)
    await expect(released).resolves.toBeUndefined()
    expect(messageWrite).not.toHaveBeenCalled()
  })

  it('releases a queued writer after rejected background cleanup', async () => {
    await startStop()
    const queuedSend = controller!.handleNativeChatSend('after failure')

    await settleCleanup(false)

    await expect(queuedSend).resolves.toBe(true)
    expect(messageWrite).toHaveBeenCalledWith('after failure', undefined)
    expect(onSendError).toHaveBeenCalledWith(
      'Agent interrupted; background cleanup not sent — send /stop to close background tools'
    )
  })
})
