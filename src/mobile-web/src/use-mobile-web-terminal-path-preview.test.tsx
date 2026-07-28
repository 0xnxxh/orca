// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { useMobileWebTerminalPathPreview } from './use-mobile-web-terminal-path-preview'

const WORKSPACE_ID = 'workspace-1'
const TAB_ID = 'tab-1'
const TOKEN = 'T'.repeat(43)

afterEach(cleanup)

describe('useMobileWebTerminalPathPreview', () => {
  it('loads an external artifact through its opaque token and releases it on close', async () => {
    const harness = clientHarness()
    harness.fileResolveTerminalPath.mockResolvedValue(terminalArtifactTarget())
    harness.fileReadTerminalArtifactChunk.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      tabId: TAB_ID,
      token: TOKEN,
      offset: 0,
      bytes: new TextEncoder().encode('hello'),
      bytesRead: 5,
      eof: true
    })
    const hook = renderPreviewHook(harness.client)

    act(() => {
      hook.result.current.openPath({
        pathText: '/private/results/report.txt',
        line: 3,
        column: 2
      })
    })
    await waitFor(() => expect(hook.result.current.preview.status).toBe('ready'))

    expect(harness.fileReadTerminalArtifactChunk).toHaveBeenCalledWith(
      {
        workspaceId: WORKSPACE_ID,
        tabId: TAB_ID,
        token: TOKEN,
        offset: 0,
        length: 128 * 1024
      },
      { signal: expect.any(AbortSignal) }
    )
    expect(hook.result.current.preview).toMatchObject({
      status: 'ready',
      target: {
        kind: 'terminal-artifact',
        displayName: 'report.txt',
        token: TOKEN
      },
      document: {
        relativePath: 'report.txt',
        content: 'hello',
        eof: true,
        revision: null
      }
    })
    expect(JSON.stringify(hook.result.current.preview)).not.toContain('/private')

    act(() => hook.result.current.closePreview())
    await waitFor(() =>
      expect(harness.fileReleaseTerminalArtifact).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        tabId: TAB_ID,
        token: TOKEN
      })
    )
    expect(hook.result.current.preview).toEqual({ status: 'idle' })
  })

  it('loads a worktree path through the ordinary bounded file reader without a token', async () => {
    const harness = clientHarness()
    harness.fileResolveTerminalPath.mockResolvedValue({
      kind: 'worktree-file',
      workspaceId: WORKSPACE_ID,
      relativePath: 'src/app.ts',
      displayName: 'app.ts',
      previewKind: 'text',
      line: null,
      column: null
    })
    harness.fileReadChunk.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      relativePath: 'src/app.ts',
      offset: 0,
      bytes: new TextEncoder().encode('export {}'),
      bytesRead: 9,
      eof: true
    })
    const hook = renderPreviewHook(harness.client)

    act(() => {
      hook.result.current.openPath({
        pathText: 'src/app.ts',
        line: null,
        column: null
      })
    })
    await waitFor(() => expect(hook.result.current.preview.status).toBe('ready'))

    expect(harness.fileReadChunk).toHaveBeenCalledWith(
      {
        workspaceId: WORKSPACE_ID,
        relativePath: 'src/app.ts',
        offset: 0,
        length: 128 * 1024
      },
      { signal: expect.any(AbortSignal) }
    )
    expect(harness.fileReadTerminalArtifactChunk).not.toHaveBeenCalled()
    expect(harness.fileReleaseTerminalArtifact).not.toHaveBeenCalled()
  })

  it('aborts and releases an in-flight artifact when its tab scope changes', async () => {
    const harness = clientHarness()
    harness.fileResolveTerminalPath.mockResolvedValue(terminalArtifactTarget())
    let resolveRead: ((value: ReturnType<typeof artifactChunk>) => void) | undefined
    harness.fileReadTerminalArtifactChunk.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve
      })
    )
    const hook = renderHook(
      ({ tabId }) =>
        useMobileWebTerminalPathPreview({
          client: harness.client,
          workspaceId: WORKSPACE_ID,
          tabId,
          connected: true
        }),
      { initialProps: { tabId: TAB_ID } }
    )

    act(() => {
      hook.result.current.openPath({
        pathText: '/private/results/report.txt',
        line: null,
        column: null
      })
    })
    await waitFor(() => expect(hook.result.current.preview.status).toBe('loading'))
    const signal = harness.fileReadTerminalArtifactChunk.mock.calls[0]?.[1]?.signal

    hook.rerender({ tabId: 'tab-2' })
    expect(signal?.aborted).toBe(true)
    await waitFor(() => expect(harness.fileReleaseTerminalArtifact).toHaveBeenCalledOnce())
    act(() => resolveRead?.(artifactChunk()))
    await waitFor(() => expect(hook.result.current.preview).toEqual({ status: 'idle' }))
  })
})

function renderPreviewHook(client: MobileWebBridgeClient) {
  return renderHook(() =>
    useMobileWebTerminalPathPreview({
      client,
      workspaceId: WORKSPACE_ID,
      tabId: TAB_ID,
      connected: true
    })
  )
}

function terminalArtifactTarget() {
  return {
    kind: 'terminal-artifact' as const,
    workspaceId: WORKSPACE_ID,
    token: TOKEN,
    displayName: 'report.txt',
    previewKind: 'text' as const,
    line: 3,
    column: 2
  }
}

function artifactChunk() {
  return {
    workspaceId: WORKSPACE_ID,
    tabId: TAB_ID,
    token: TOKEN,
    offset: 0,
    bytes: new TextEncoder().encode('hello'),
    bytesRead: 5,
    eof: true
  }
}

function clientHarness() {
  const fileResolveTerminalPath = vi.fn()
  const fileReadTerminalArtifactChunk = vi.fn()
  const fileReleaseTerminalArtifact = vi.fn().mockResolvedValue(null)
  const fileReadChunk = vi.fn()
  const client = {
    fileResolveTerminalPath,
    fileReadTerminalArtifactChunk,
    fileReleaseTerminalArtifact,
    fileReadChunk
  } as unknown as MobileWebBridgeClient
  return {
    client,
    fileResolveTerminalPath,
    fileReadTerminalArtifactChunk,
    fileReleaseTerminalArtifact,
    fileReadChunk
  }
}
