import { beforeEach, expect, it, vi } from 'vitest'

const { readSnapshotFileMock } = vi.hoisted(() => ({
  readSnapshotFileMock: vi.fn()
}))

vi.mock('../filesystem-host/filesystem-host-read-authority', () => ({
  readSnapshotFileThroughFilesystemHost: readSnapshotFileMock
}))

import { readAuthJsonSource } from './gemini-oauth-sources'

beforeEach(() => {
  readSnapshotFileMock.mockReset()
})

it('treats non-object OpenCode auth JSON as an unavailable source', async () => {
  readSnapshotFileMock.mockResolvedValue(Buffer.from('null'))

  await expect(readAuthJsonSource()).resolves.toBeNull()
})

it('preserves unrelated OpenCode providers in the writable source', async () => {
  readSnapshotFileMock.mockResolvedValue(
    Buffer.from('{"google":{"type":"oauth","access":"a","expires":1,"refresh":"r"},"other":{}}')
  )

  await expect(readAuthJsonSource()).resolves.toMatchObject({
    value: { google: { type: 'oauth' }, other: {} }
  })
})
