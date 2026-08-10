import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'
import { useMobileStructuredSessionOptions } from './use-mobile-structured-session-options'

describe('useMobileStructuredSessionOptions', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatSessionOptionsController | null = null
  const setOption = vi.fn<(key: string, value: string) => Promise<boolean>>()

  function Probe(): null {
    controller = useMobileStructuredSessionOptions({ sessionId: 'mobile_1', setOption })
    return null
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    setOption.mockReset().mockResolvedValue(true)
    act(() => {
      renderer = create(createElement(Probe))
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })

  it('uses agentSession.setOption and tracks the applied model and effort', async () => {
    await act(async () => {
      await controller!.setOption('model', 'gpt-5.6-sol')
    })
    await act(async () => {
      await controller!.setOption('effort', 'high')
    })

    expect(setOption).toHaveBeenNthCalledWith(1, 'model', 'gpt-5.6-sol')
    expect(setOption).toHaveBeenNthCalledWith(2, 'effort', 'high')
    expect(controller!.snapshot.find((entry) => entry.id === 'model')?.kind).toMatchObject({
      currentValue: 'gpt-5.6-sol'
    })
    expect(controller!.snapshot.find((entry) => entry.id === 'effort')?.kind).toMatchObject({
      currentValue: 'high'
    })
  })

  it('does not claim a rejected option was applied', async () => {
    setOption.mockResolvedValue(false)
    await act(async () => {
      await controller!.setOption('model', 'gpt-5.6-terra')
    })

    expect(controller!.snapshot.find((entry) => entry.id === 'model')).toMatchObject({
      valueSource: 'unknown'
    })
  })
})
