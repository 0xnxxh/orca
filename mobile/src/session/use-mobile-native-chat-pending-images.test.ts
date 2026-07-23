import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pickMobileImage = vi.fn()
// Fully mocked (no importOriginal): the real module imports expo pickers, whose
// react-native dependency chain doesn't parse under vitest.
vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImage: (...args: unknown[]) => pickMobileImage(...args),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

const saveMobileClipboardImageAsTempFile = vi.fn()
vi.mock('./mobile-clipboard-image', () => ({
  saveMobileClipboardImageAsTempFile: (...args: unknown[]) =>
    saveMobileClipboardImageAsTempFile(...args),
  buildMobileImagePastePayload: (filePath: string) => filePath
}))

import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatPendingImages } from './use-mobile-native-chat-pending-images'

type PendingImagesState = ReturnType<typeof useMobileNativeChatPendingImages>

const client = { sendRequest: vi.fn() } as unknown as RpcClient
const showToast = vi.fn()
const onSuccess = vi.fn()
const onError = vi.fn()

describe('useMobileNativeChatPendingImages', () => {
  let renderer: ReactTestRenderer | null = null
  let state: PendingImagesState | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
  })

  function Harness({
    activeHandle = 't1',
    rpcClient = client,
    attachmentScopeKey = activeHandle ?? 'none'
  }: {
    activeHandle?: string | null
    rpcClient?: RpcClient
    attachmentScopeKey?: string
  }): null {
    state = useMobileNativeChatPendingImages({
      client: rpcClient,
      activeHandle,
      attachmentScopeKey,
      canAttach: true,
      connState: 'connected',
      getConnectionId: async () => null,
      showToast,
      onSuccess,
      onError
    })
    return null
  }

  function render(activeHandle?: string | null): void {
    act(() => {
      renderer = create(createElement(Harness, { activeHandle }))
    })
  }

  it('adds an uploading entry on pick and flips it ready after the host upload', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///pick.jpg' })
    let resolveUpload: (path: string) => void = () => {}
    saveMobileClipboardImageAsTempFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUpload = resolve
      })
    )
    render()

    let attachDone: Promise<void> = Promise.resolve()
    await act(async () => {
      attachDone = state!.attachPendingChatImage('library')
      // Let the pick resolve and the uploading entry land.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(state!.pendingChatImages).toEqual([
      { id: 'chat-image-1', thumbnailUri: 'file:///pick.jpg', status: 'uploading', hostPath: null }
    ])
    expect(state!.getSendableChatImages()).toEqual([])

    await act(async () => {
      resolveUpload('/tmp/orca-img.png')
      await attachDone
    })
    expect(state!.pendingChatImages[0]).toMatchObject({ id: 'chat-image-1', status: 'ready' })
    expect(state!.getSendableChatImages()).toEqual([
      { id: 'chat-image-1', status: 'ready', hostPath: '/tmp/orca-img.png' }
    ])
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('falls back to a data URI thumbnail when the picker has no file URI', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA' })
    saveMobileClipboardImageAsTempFile.mockResolvedValue('/tmp/a.png')
    render()

    await act(async () => {
      await state!.attachPendingChatImage('library')
    })
    expect(state!.pendingChatImages[0]?.thumbnailUri).toBe('data:image/png;base64,AAAA')
  })

  it('adds nothing when the picker is cancelled', async () => {
    pickMobileImage.mockResolvedValue(null)
    render()

    await act(async () => {
      await state!.attachPendingChatImage('library')
    })
    expect(state!.pendingChatImages).toEqual([])
    expect(showToast).not.toHaveBeenCalled()
  })

  it('removes the entry and toasts when the upload fails', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///pick.jpg' })
    saveMobileClipboardImageAsTempFile.mockRejectedValue(new Error('upload broke'))
    render()

    await act(async () => {
      await state!.attachPendingChatImage('library')
    })
    expect(state!.pendingChatImages).toEqual([])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Attach failed', 1500)
  })

  it('removes a pending image and consumes delivered ones', async () => {
    pickMobileImage
      .mockResolvedValueOnce({ base64: 'AAAA', uri: 'file:///a.jpg' })
      .mockResolvedValueOnce({ base64: 'BBBB', uri: 'file:///b.jpg' })
    saveMobileClipboardImageAsTempFile
      .mockResolvedValueOnce('/tmp/a.png')
      .mockResolvedValueOnce('/tmp/b.png')
    render()

    await act(async () => {
      await state!.attachPendingChatImage('library')
      await state!.attachPendingChatImage('library')
    })
    expect(state!.getSendableChatImages()).toHaveLength(2)

    act(() => state!.removePendingChatImage('chat-image-1'))
    expect(state!.getSendableChatImages()).toEqual([
      { id: 'chat-image-2', status: 'ready', hostPath: '/tmp/b.png' }
    ])

    act(() => state!.consumePendingChatImages(['chat-image-2']))
    expect(state!.pendingChatImages).toEqual([])
  })

  it('drops pending images when the active terminal handle changes', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    saveMobileClipboardImageAsTempFile.mockResolvedValue('/tmp/a.png')
    render('t1')

    await act(async () => {
      await state!.attachPendingChatImage('library')
    })
    expect(state!.pendingChatImages).toHaveLength(1)

    act(() => {
      renderer!.update(createElement(Harness, { activeHandle: 't2' }))
    })
    expect(state!.pendingChatImages).toEqual([])
    expect(state!.getSendableChatImages()).toEqual([])
  })

  it('retains pasted images until submission and prevents removing them', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    saveMobileClipboardImageAsTempFile.mockResolvedValue('/tmp/a.png')
    render()

    await act(async () => {
      await state!.attachPendingChatImage('library')
    })
    act(() => state!.markPendingChatImagesPasted(['chat-image-1']))

    expect(state!.getSendableChatImages()).toEqual([{ id: 'chat-image-1', status: 'pasted' }])
    act(() => state!.removePendingChatImage('chat-image-1'))
    expect(state!.pendingChatImages).toHaveLength(1)
    act(() => state!.consumePendingChatImages(['chat-image-1']))
    expect(state!.pendingChatImages).toEqual([])
  })

  it('drops pending images when the RPC client changes for the same terminal handle', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    saveMobileClipboardImageAsTempFile.mockResolvedValue('/tmp/a.png')
    render('t1')
    await act(async () => {
      await state!.attachPendingChatImage('library')
    })

    const nextClient = { sendRequest: vi.fn() } as unknown as RpcClient
    act(() => {
      renderer!.update(
        createElement(Harness, {
          activeHandle: 't1',
          rpcClient: nextClient,
          attachmentScopeKey: 't1'
        })
      )
    })

    expect(state!.pendingChatImages).toEqual([])
  })

  it('does not attach a picker result to a terminal selected while the picker was open', async () => {
    let resolvePick: (image: { base64: string; uri: string }) => void = () => {}
    pickMobileImage.mockReturnValue(
      new Promise((resolve) => {
        resolvePick = resolve
      })
    )
    render('t1')

    let attachDone: Promise<void> = Promise.resolve()
    act(() => {
      attachDone = state!.attachPendingChatImage('library')
      renderer!.update(createElement(Harness, { activeHandle: 't2' }))
    })
    await act(async () => {
      resolvePick({ base64: 'AAAA', uri: 'file:///a.jpg' })
      await attachDone
    })

    expect(state!.pendingChatImages).toEqual([])
    expect(saveMobileClipboardImageAsTempFile).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not attach a picker result after switching away and back to the same target', async () => {
    let resolvePick: (image: { base64: string; uri: string }) => void = () => {}
    pickMobileImage.mockReturnValue(
      new Promise((resolve) => {
        resolvePick = resolve
      })
    )
    render('t1')

    let attachDone: Promise<void> = Promise.resolve()
    act(() => {
      attachDone = state!.attachPendingChatImage('library')
    })
    act(() => {
      renderer!.update(createElement(Harness, { activeHandle: 't2' }))
    })
    act(() => {
      renderer!.update(createElement(Harness, { activeHandle: 't1' }))
    })
    await act(async () => {
      resolvePick({ base64: 'AAAA', uri: 'file:///a.jpg' })
      await attachDone
    })

    expect(state!.pendingChatImages).toEqual([])
    expect(saveMobileClipboardImageAsTempFile).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not report upload success after the pending image was removed', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    let resolveUpload: (path: string) => void = () => {}
    saveMobileClipboardImageAsTempFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUpload = resolve
      })
    )
    render()

    let attachDone: Promise<void> = Promise.resolve()
    await act(async () => {
      attachDone = state!.attachPendingChatImage('library')
      await Promise.resolve()
      await Promise.resolve()
    })
    const uploadCall = saveMobileClipboardImageAsTempFile.mock.calls[0]
    expect(uploadCall).toBeDefined()
    const uploadSignal = (uploadCall![2] as { signal?: AbortSignal }).signal
    expect(uploadSignal?.aborted).toBe(false)
    act(() => state!.removePendingChatImage('chat-image-1'))
    expect(uploadSignal?.aborted).toBe(true)
    await act(async () => {
      resolveUpload('/tmp/a.png')
      await attachDone
    })

    expect(state!.pendingChatImages).toEqual([])
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('releases pending state and ignores upload completion after unmount', async () => {
    pickMobileImage.mockResolvedValue({ base64: 'AAAA', uri: 'file:///a.jpg' })
    let resolveUpload: (path: string) => void = () => {}
    saveMobileClipboardImageAsTempFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUpload = resolve
      })
    )
    render()

    let attachDone: Promise<void> = Promise.resolve()
    await act(async () => {
      attachDone = state!.attachPendingChatImage('library')
      await Promise.resolve()
      await Promise.resolve()
    })
    const uploadCall = saveMobileClipboardImageAsTempFile.mock.calls[0]
    expect(uploadCall).toBeDefined()
    const uploadSignal = (uploadCall![2] as { signal?: AbortSignal }).signal
    act(() => renderer!.unmount())
    renderer = null
    expect(uploadSignal?.aborted).toBe(true)
    await act(async () => {
      resolveUpload('/tmp/a.png')
      await attachDone
    })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
