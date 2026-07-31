import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  getMacosFullDiskAccessStatus,
  probeMacosFullDiskAccess
} from './macos-full-disk-access-status'

const originalPlatform = process.platform
const homeDirectory = join('Users', 'tester')
const databasePath = join(
  homeDirectory,
  'Library',
  'Application Support',
  'com.apple.TCC',
  'TCC.db'
)

function fileSystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
})

describe('probeMacosFullDiskAccess', () => {
  it('reports granted only when the TCC database opens for reading', () => {
    const readProbe = vi.fn()

    expect(probeMacosFullDiskAccess({ homeDirectory, readProbe })).toBe('granted')
    expect(readProbe).toHaveBeenCalledWith(databasePath)
  })

  it.each(['EACCES', 'EPERM'])('reports denied for %s', (code) => {
    expect(
      probeMacosFullDiskAccess({
        homeDirectory,
        readProbe: () => {
          throw fileSystemError(code)
        }
      })
    ).toBe('denied')
  })

  it.each(['ENOENT', 'ENOTDIR', 'EBUSY'])('keeps %s failures unknown', (code) => {
    expect(
      probeMacosFullDiskAccess({
        homeDirectory,
        readProbe: () => {
          throw fileSystemError(code)
        }
      })
    ).toBe('unknown')
  })
})

describe('getMacosFullDiskAccessStatus', () => {
  it('is unsupported off macOS', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })

    expect(getMacosFullDiskAccessStatus()).toBe('unsupported')
  })
})
