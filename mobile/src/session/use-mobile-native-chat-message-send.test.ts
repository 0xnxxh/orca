// Covers the wiring the image-attachments suite structurally cannot: that hook
// injects its own baseSend stub, so it never observes the real send params.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendWithOutcome = vi.fn()
vi.mock('./mobile-native-chat-send', () => ({
  sendMobileNativeChatMessageWithOutcome: (...args: unknown[]) => sendWithOutcome(...args),
  openMobileNativeChatSendBudget: () => Date.now() + 15_000,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS: 15_000,
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS: 2_000
}))
vi.mock('./mobile-native-chat-stale-input', () => ({
  healMobileNativeChatStaleInput: () => Promise.resolve(true)
}))

import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { buildAgentTuiClearInputForText } from '../../../src/shared/agent-tui-input-clear'

type Send = ReturnType<typeof useMobileNativeChatMessageSend>

const DRAFT = 'Linked Linear issue: ABC-123\nhttps://linear.app/x/issue/ABC-123'

describe('useMobileNativeChatMessageSend', () => {
  let renderer: ReactTestRenderer | null = null
  let api: Send | null = null

  const mount = (readSeededLaunchDraft: () => string | null): void => {
    function Probe(): null {
      api = useMobileNativeChatMessageSend({
        client: { sendRequest: vi.fn() } as never,
        enabled: true,
        handleRef: { current: 'term' },
        deviceTokenRef: { current: 'device' },
        captureSendOrigin: () => ({ draftKey: 'k', pendingKey: 'p' }) as never,
        readSeededLaunchDraft,
        clearDraftForSend: () => {},
        restoreRejectedDraft: () => {},
        acceptSend: () => {},
        holdUnconfirmedSend: () => {},
        onSendError: () => {}
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  const sentArgs = (): { clearInput?: string; clearInputFirst?: boolean } =>
    sendWithOutcome.mock.calls[0]![0] as { clearInput?: string; clearInputFirst?: boolean }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    sendWithOutcome.mockReset()
    sendWithOutcome.mockResolvedValue('accepted')
  })
  afterEach(() => {
    act(() => {
      renderer?.unmount()
    })
    renderer = null
    api = null
  })

  it('sizes the pre-clear to every line of a parked launch draft', async () => {
    mount(() => DRAFT)
    await act(async () => {
      await api!.send('hello')
    })
    expect(sentArgs().clearInput).toBe(buildAgentTuiClearInputForText(DRAFT))
  })

  it('sends no clearInput at all when nothing is parked on the line', async () => {
    mount(() => null)
    await act(async () => {
      await api!.send('hello')
    })
    expect(sentArgs().clearInput).toBeUndefined()
  })

  it('reads the draft at send time, so a retired seed stops widening the clear', async () => {
    let parked: string | null = DRAFT
    mount(() => parked)
    await act(async () => {
      await api!.send('first')
    })
    parked = null
    await act(async () => {
      await api!.send('second')
    })
    expect(sendWithOutcome.mock.calls[1]![0]).toMatchObject({ clearInputFirst: true })
    expect(
      (sendWithOutcome.mock.calls[1]![0] as { clearInput?: string }).clearInput
    ).toBeUndefined()
  })

  it('still skips the pre-clear for an image send, which pasted its own first', async () => {
    // A second clear here would wipe the image that was just pasted.
    mount(() => DRAFT)
    await act(async () => {
      await api!.send('caption', ['file:///a.png'])
    })
    expect(sentArgs().clearInputFirst).toBe(false)
  })
})
