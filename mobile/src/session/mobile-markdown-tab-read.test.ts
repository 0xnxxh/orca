import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import type { MobileSessionTab } from './mobile-session-route-types'
import { readMobileMarkdownTab } from './mobile-markdown-tab-read'

const tab: Extract<MobileSessionTab, { type: 'markdown' }> = {
  type: 'markdown',
  id: '/repo/README.md',
  title: 'README.md',
  filePath: '/repo/README.md',
  relativePath: 'README.md',
  language: 'markdown',
  mode: 'edit',
  isDirty: false,
  isActive: true
}

function success(result: unknown): RpcResponse {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

describe('readMobileMarkdownTab', () => {
  it('builds the editable document from the renderer response', async () => {
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockResolvedValue(
        success({ content: '# Current', version: 'v2', isDirty: true, editable: true })
      )

    await expect(
      readMobileMarkdownTab({ sendRequest }, 'worktree-1', tab, () => true)
    ).resolves.toEqual({
      status: 'ready',
      content: '# Current',
      localContent: '# Current',
      baseVersion: 'v2',
      isDirty: false,
      editable: true,
      stale: true
    })
  })

  it('drops a response after its route loses ownership', async () => {
    let ownsRoute = true
    const sendRequest = vi.fn<RpcClient['sendRequest']>().mockImplementation(async () => {
      ownsRoute = false
      return success({ content: '# Old route', version: 'v1', isDirty: false, editable: true })
    })

    await expect(
      readMobileMarkdownTab({ sendRequest }, 'worktree-1', tab, () => ownsRoute)
    ).resolves.toBeNull()
  })

  it('falls back to a read-only disk document on headless hosts', async () => {
    const sendRequest = vi
      .fn<RpcClient['sendRequest']>()
      .mockResolvedValueOnce({
        id: 'rpc-1',
        ok: false,
        error: { code: 'renderer_unavailable', message: 'renderer_unavailable' },
        _meta: { runtimeId: 'runtime-1' }
      })
      .mockResolvedValueOnce(success({ content: '# Disk', truncated: false, byteLength: 6 }))

    await expect(
      readMobileMarkdownTab({ sendRequest }, 'worktree-1', tab, () => true)
    ).resolves.toMatchObject({
      status: 'ready',
      content: '# Disk',
      editable: false,
      stale: false
    })
  })
})
