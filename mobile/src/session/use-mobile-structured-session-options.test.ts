import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'
import { useMobileStructuredSessionOptions } from './use-mobile-structured-session-options'

describe('useMobileStructuredSessionOptions', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileNativeChatSessionOptionsController | null = null
  let sessionId = 'mobile_1'
  const setOption = vi.fn<(key: string, value: string) => Promise<boolean>>()

  function Probe(): null {
    controller = useMobileStructuredSessionOptions({ sessionId, setOption })
    return null
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    setOption.mockReset().mockResolvedValue(true)
    sessionId = 'mobile_1'
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

  it('does not apply an in-flight option result to a replacement session', async () => {
    let resolve!: (applied: boolean) => void
    setOption.mockReturnValueOnce(new Promise<boolean>((done) => (resolve = done)))
    let oldResult!: boolean
    let pending!: Promise<boolean>
    act(() => {
      pending = controller!.setOption('model', 'gpt-5.6-sol')
    })
    sessionId = 'mobile_2'
    act(() => renderer!.update(createElement(Probe)))
    await act(async () => {
      resolve(true)
      oldResult = await pending
    })

    expect(oldResult).toBe(false)
    expect(controller!.pendingId).toBeNull()
    expect(controller!.snapshot.find((entry) => entry.id === 'model')).toMatchObject({
      valueSource: 'unknown'
    })
  })

  it('does not restore stale pending state when returning to a prior session', async () => {
    const oldRequest = new Promise<boolean>(() => {})
    setOption.mockReturnValueOnce(oldRequest).mockResolvedValueOnce(true)
    act(() => {
      void controller!.setOption('model', 'gpt-5.6-sol')
    })
    sessionId = 'mobile_2'
    act(() => renderer!.update(createElement(Probe)))
    sessionId = 'mobile_1'
    act(() => renderer!.update(createElement(Probe)))

    let applied!: boolean
    await act(async () => {
      applied = await controller!.setOption('effort', 'high')
    })

    expect(applied).toBe(true)
    expect(setOption).toHaveBeenNthCalledWith(2, 'effort', 'high')
  })
})
