import { describe, expect, it } from 'vitest'
import {
  MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES,
  appendMobileWebFileChunk,
  mobileWebFileNextChunkLength
} from './mobile-web-file-document'

describe('mobile web file document', () => {
  it('assembles ordered chunks without corrupting split UTF-8 characters', () => {
    const first = appendMobileWebFileChunk(null, {
      workspaceId: 'workspace-1',
      relativePath: 'notes.txt',
      offset: 0,
      bytes: Uint8Array.from([0x41, 0xe2, 0x82]),
      bytesRead: 3,
      eof: false
    })
    expect(first.content).toBe('A')

    const complete = appendMobileWebFileChunk(first, {
      workspaceId: 'workspace-1',
      relativePath: 'notes.txt',
      offset: 3,
      bytes: Uint8Array.from([0xac, 0x42]),
      bytesRead: 2,
      eof: true
    })
    expect(complete.content).toBe('A€B')
    expect(complete.kind).toBe('text')
    expect(complete.eof).toBe(true)
  })

  it('rejects reordered, empty non-final, and cross-file chunks', () => {
    const initial = appendMobileWebFileChunk(null, {
      workspaceId: 'workspace-1',
      relativePath: 'notes.txt',
      offset: 0,
      bytes: Uint8Array.from([65]),
      bytesRead: 1,
      eof: false
    })
    expect(() =>
      appendMobileWebFileChunk(initial, {
        workspaceId: 'workspace-1',
        relativePath: 'other.txt',
        offset: 1,
        bytes: new Uint8Array(),
        bytesRead: 0,
        eof: false
      })
    ).toThrow()
    expect(() =>
      appendMobileWebFileChunk(initial, {
        workspaceId: 'workspace-1',
        relativePath: 'notes.txt',
        offset: 0,
        bytes: Uint8Array.from([66]),
        bytesRead: 1,
        eof: true
      })
    ).toThrow()
  })

  it('detects binary content and enforces the page document cap', () => {
    const binary = appendMobileWebFileChunk(null, {
      workspaceId: 'workspace-1',
      relativePath: 'image.bin',
      offset: 0,
      bytes: Uint8Array.from([65, 0, 66]),
      bytesRead: 3,
      eof: true
    })
    expect(binary.kind).toBe('binary')

    const nearLimit = {
      workspaceId: 'workspace-1',
      relativePath: 'large.txt',
      bytes: new Uint8Array(MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES - 1),
      content: '',
      kind: 'text' as const,
      eof: false,
      limitReached: false,
      revision: null
    }
    expect(mobileWebFileNextChunkLength(nearLimit)).toBe(1)
    const capped = appendMobileWebFileChunk(nearLimit, {
      workspaceId: 'workspace-1',
      relativePath: 'large.txt',
      offset: MOBILE_WEB_FILE_DOCUMENT_MAX_BYTES - 1,
      bytes: Uint8Array.from([65]),
      bytesRead: 1,
      eof: false
    })
    expect(capped.limitReached).toBe(true)
    expect(mobileWebFileNextChunkLength(capped)).toBe(0)
  })

  it('supports a separate bounded assembly limit for raster images', () => {
    const maximum = 4
    const initial = appendMobileWebFileChunk(
      null,
      {
        workspaceId: 'workspace-1',
        relativePath: 'image.png',
        offset: 0,
        bytes: Uint8Array.from([0x89, 0x50]),
        bytesRead: 2,
        eof: false
      },
      maximum
    )
    expect(mobileWebFileNextChunkLength(initial, maximum)).toBe(2)

    const capped = appendMobileWebFileChunk(
      initial,
      {
        workspaceId: 'workspace-1',
        relativePath: 'image.png',
        offset: 2,
        bytes: Uint8Array.from([0x4e, 0x47]),
        bytesRead: 2,
        eof: false
      },
      maximum
    )
    expect(capped.limitReached).toBe(true)
    expect(mobileWebFileNextChunkLength(capped, maximum)).toBe(0)
  })
})
