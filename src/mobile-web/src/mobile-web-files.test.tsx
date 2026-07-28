// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MobileWebFileChunkResult,
  MobileWebFileDirectoryResult,
  MobileWebFileListResult
} from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { mobileWebFileRevision } from './mobile-web-file-edit-content'
import { MobileWebFiles } from './mobile-web-files'

beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:private-image'),
    revokeObjectURL: vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MobileWebFiles', () => {
  it('keeps path search literal on mobile keyboards', () => {
    const client = fileClient()

    render(createElement(MobileWebFiles, { client, workspaceId: 'workspace-1', connected: true }))

    const input = screen.getByRole('textbox', { name: 'Search workspace files' })
    expect(input.getAttribute('autocapitalize')).toBe('none')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  it('navigates bounded directories, searches paths, and renders file bytes as inert text', async () => {
    const client = fileClient()
    render(createElement(MobileWebFiles, { client, workspaceId: 'workspace-1', connected: true }))

    fireEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('app.ts')).toBeDefined()
    fireEvent.click(screen.getByText('app.ts'))
    expect(await screen.findByText('<script>not executable</script>')).toBeDefined()

    const search = screen.getByLabelText('Search workspace files')
    fireEvent.change(search, { target: { value: 'logo' } })
    fireEvent.submit(search.closest('form')!)
    await vi.waitFor(() =>
      expect(client.fileSearch).toHaveBeenCalledWith(
        { workspaceId: 'workspace-1', query: 'logo', limit: 32 },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    fireEvent.click(await screen.findByText('logo.png'))
    expect(await screen.findByRole('img', { name: 'Preview of logo.png' })).toBeDefined()
    expect(client.fileReadChunk).toHaveBeenLastCalledWith(
      expect.objectContaining({ relativePath: 'assets/logo.png', offset: 0 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('loads ordered chunks on demand without corrupting split UTF-8', async () => {
    const firstBytes = Uint8Array.from([0x41, 0xe2, 0x82])
    const secondBytes = Uint8Array.from([0xac, 0x42])
    const client = fileClient()
    client.fileReadChunk
      .mockResolvedValueOnce(fileChunk('large.txt', 0, firstBytes, false))
      .mockResolvedValueOnce(fileChunk('large.txt', firstBytes.byteLength, secondBytes, true))

    render(createElement(MobileWebFiles, { client, workspaceId: 'workspace-1', connected: true }))
    fireEvent.click(await screen.findByText('large.txt'))
    expect(await screen.findByText('A')).toBeDefined()
    fireEvent.click(screen.getByText('Load more'))
    expect(await screen.findByText('A€B')).toBeDefined()
    expect(client.fileReadChunk).toHaveBeenLastCalledWith(
      expect.objectContaining({ relativePath: 'large.txt', offset: 3 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('aborts and drops a delayed file chunk after the workspace client changes', async () => {
    let resolveChunk: ((result: MobileWebFileChunkResult) => void) | undefined
    const first = fileClient()
    first.fileReadChunk.mockReturnValue(
      new Promise((resolve) => {
        resolveChunk = resolve
      })
    )
    const second = fileClient(emptyDirectory('workspace-2'))
    const view = render(
      createElement(MobileWebFiles, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true
      })
    )
    fireEvent.click(await screen.findByText('large.txt'))
    const requestSignal = first.fileReadChunk.mock.calls[0]?.[1]?.signal as AbortSignal

    view.rerender(
      createElement(MobileWebFiles, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true
      })
    )
    expect(requestSignal.aborted).toBe(true)
    resolveChunk?.(
      fileChunk('large.txt', 0, new TextEncoder().encode('old-host-secret'), true, 'workspace-1')
    )
    await Promise.resolve()

    expect(screen.queryByText('old-host-secret')).toBeNull()
  })

  it('aborts an image read and revokes its object URL when the workspace changes', async () => {
    let resolveSecondChunk: ((result: MobileWebFileChunkResult) => void) | undefined
    const first = fileClient()
    const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    first.fileReadChunk
      .mockResolvedValueOnce(fileChunk('assets/logo.png', 0, signature, false))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecondChunk = resolve
        })
      )
    const second = fileClient(emptyDirectory('workspace-2'))
    const view = render(
      createElement(MobileWebFiles, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true
      })
    )
    const search = screen.getByLabelText('Search workspace files')
    fireEvent.change(search, { target: { value: 'logo' } })
    fireEvent.submit(search.closest('form')!)
    fireEvent.click(await screen.findByText('logo.png'))
    await vi.waitFor(() => expect(first.fileReadChunk).toHaveBeenCalledTimes(2))
    const requestSignal = first.fileReadChunk.mock.calls[1]?.[1]?.signal as AbortSignal

    view.rerender(
      createElement(MobileWebFiles, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true
      })
    )
    expect(requestSignal.aborted).toBe(true)
    resolveSecondChunk?.(
      fileChunk('assets/logo.png', signature.byteLength, Uint8Array.from([0]), true)
    )
    await Promise.resolve()

    expect(screen.queryByRole('img', { name: 'Preview of logo.png' })).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('revokes a completed image URL when switching workspace clients', async () => {
    const first = fileClient()
    const second = fileClient(emptyDirectory('workspace-2'))
    const view = render(
      createElement(MobileWebFiles, {
        client: first,
        workspaceId: 'workspace-1',
        connected: true
      })
    )
    const search = screen.getByLabelText('Search workspace files')
    fireEvent.change(search, { target: { value: 'logo' } })
    fireEvent.submit(search.closest('form')!)
    fireEvent.click(await screen.findByText('logo.png'))
    expect(await screen.findByRole('img', { name: 'Preview of logo.png' })).toBeDefined()

    view.rerender(
      createElement(MobileWebFiles, {
        client: second,
        workspaceId: 'workspace-2',
        connected: true
      })
    )
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-image'))
  })

  it('edits a complete text file with its loaded revision and reloads after save', async () => {
    const client = fileClient()
    render(createElement(MobileWebFiles, { client, workspaceId: 'workspace-1', connected: true }))
    fireEvent.click(await screen.findByText('large.txt'))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = screen.getByRole('textbox', { name: 'Edit large.txt' })
    fireEvent.change(editor, { target: { value: 'updated content' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(client.fileWrite).toHaveBeenCalledWith(
        {
          workspaceId: 'workspace-1',
          relativePath: 'large.txt',
          expectedRevision: mobileWebFileRevision(
            new TextEncoder().encode('<script>not executable</script>')
          ),
          contentBase64: btoa('updated content')
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    expect(await screen.findByText('<script>not executable</script>')).toBeDefined()
  })

  it('keeps the draft and shows an actionable conflict when Desktop changed the file', async () => {
    const client = fileClient()
    client.fileWrite.mockRejectedValueOnce(new MobileWebBridgeClientError('conflict', false))
    render(createElement(MobileWebFiles, { client, workspaceId: 'workspace-1', connected: true }))
    fireEvent.click(await screen.findByText('large.txt'))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit large.txt' }), {
      target: { value: 'stale draft' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(
        'This file changed on the desktop. Cancel and reopen it before saving.'
      )
    ).toBeDefined()
    expect(screen.getByDisplayValue('stale draft')).toBeDefined()
  })
})

function fileClient(root = rootDirectory()): MobileWebBridgeClient & {
  fileDirectory: ReturnType<typeof vi.fn>
  fileSearch: ReturnType<typeof vi.fn>
  fileReadChunk: ReturnType<typeof vi.fn>
  fileWrite: ReturnType<typeof vi.fn>
} {
  return {
    fileDirectory: vi.fn().mockImplementation(({ workspaceId, relativePath }) => {
      if (relativePath === 'src') {
        return Promise.resolve({
          workspaceId,
          relativePath,
          revision: 'b'.repeat(64),
          entries: [{ name: 'app.ts', isDirectory: false, isSymlink: false }],
          truncated: false
        })
      }
      return Promise.resolve({ ...root, workspaceId })
    }),
    fileSearch: vi.fn().mockResolvedValue(searchResult()),
    fileWrite: vi.fn().mockImplementation(({ workspaceId, relativePath, contentBase64 }) => {
      const bytes = Uint8Array.from(atob(contentBase64), (character) => character.charCodeAt(0))
      return Promise.resolve({
        workspaceId,
        relativePath,
        revision: mobileWebFileRevision(bytes),
        byteLength: bytes.byteLength,
        outcome: 'updated'
      })
    }),
    fileReadChunk: vi.fn().mockImplementation(({ workspaceId, relativePath, offset }) => {
      const bytes =
        relativePath === 'assets/logo.png'
          ? Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          : new TextEncoder().encode('<script>not executable</script>')
      return Promise.resolve({
        workspaceId,
        relativePath,
        offset,
        bytes,
        bytesRead: bytes.byteLength,
        eof: true
      })
    })
  } as unknown as MobileWebBridgeClient & {
    fileDirectory: ReturnType<typeof vi.fn>
    fileSearch: ReturnType<typeof vi.fn>
    fileReadChunk: ReturnType<typeof vi.fn>
    fileWrite: ReturnType<typeof vi.fn>
  }
}

function rootDirectory(): MobileWebFileDirectoryResult {
  return {
    workspaceId: 'workspace-1',
    relativePath: '',
    revision: 'a'.repeat(64),
    entries: [
      { name: 'src', isDirectory: true, isSymlink: false },
      { name: 'large.txt', isDirectory: false, isSymlink: false }
    ],
    truncated: false
  }
}

function emptyDirectory(workspaceId: string): MobileWebFileDirectoryResult {
  return {
    workspaceId,
    relativePath: '',
    revision: 'c'.repeat(64),
    entries: [],
    truncated: false
  }
}

function searchResult(): MobileWebFileListResult {
  return {
    workspaceId: 'workspace-1',
    files: [{ relativePath: 'assets/logo.png', basename: 'logo.png', kind: 'binary' }],
    totalCount: 1,
    truncated: false
  }
}

function fileChunk(
  relativePath: string,
  offset: number,
  bytes: Uint8Array,
  eof: boolean,
  workspaceId = 'workspace-1'
): MobileWebFileChunkResult {
  return {
    workspaceId,
    relativePath,
    offset,
    bytes,
    bytesRead: bytes.byteLength,
    eof
  }
}
