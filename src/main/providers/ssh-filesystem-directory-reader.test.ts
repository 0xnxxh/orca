import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILESYSTEM_DIRECTORY_MAX_ENTRIES,
  FILESYSTEM_DIRECTORY_MAX_RETAINED_BYTES
} from '../../shared/filesystem-directory-listing-limit'
import { JsonRpcErrorCode } from '../ssh/relay-protocol'
import { SshFilesystemDirectoryReader } from './ssh-filesystem-directory-reader'

describe('SshFilesystemDirectoryReader', () => {
  const request = vi.fn()
  let reader: SshFilesystemDirectoryReader

  beforeEach(() => {
    request.mockReset()
    reader = new SshFilesystemDirectoryReader({ request } as never)
  })

  it('sends a producer-bounded directory request', async () => {
    const entries = [
      { name: 'src', isDirectory: true, isSymlink: false },
      { name: 'README.md', isDirectory: false, isSymlink: false }
    ]
    request.mockResolvedValue(entries)

    await expect(reader.readDir('/home/user/project')).resolves.toEqual(entries)
    expect(request).toHaveBeenCalledWith('fs.readDirBounded', {
      dirPath: '/home/user/project',
      maxEntries: FILESYSTEM_DIRECTORY_MAX_ENTRIES,
      maxRetainedBytes: FILESYSTEM_DIRECTORY_MAX_RETAINED_BYTES
    })
  })

  it('requires relay replacement instead of falling back to unbounded enumeration', async () => {
    request.mockRejectedValue(
      Object.assign(new Error('Method not found'), { code: JsonRpcErrorCode.MethodNotFound })
    )

    await expect(reader.readDir('/home/user/project')).rejects.toThrow(
      'Safe remote directory browsing'
    )
    await expect(reader.readDir('/home/user/project')).rejects.toThrow(
      'Safe remote directory browsing'
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalledWith('fs.readDir', expect.anything())
  })
})
