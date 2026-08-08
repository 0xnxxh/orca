import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const openedFlags: string[] = []

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  return {
    ...actual,
    openSync: (path: Parameters<typeof actual.openSync>[0], flags: string | number) => {
      openedFlags.push(String(flags))
      return actual.openSync(path, flags)
    }
  }
})

describe('durable file fsync handles', () => {
  let directory: string | undefined

  afterEach(() => {
    openedFlags.length = 0
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
      directory = undefined
    }
  })

  it('opens lifecycle files with a writable fsync handle', async () => {
    // macOS proves the flag; real Windows FlushFileBuffers proof remains outstanding here.
    const { fsyncFileSync } = await import('./durable-file-write.js')
    directory = mkdtempSync(join(tmpdir(), 'orca-durable-fsync-handle-'))
    const filePath = join(directory, 'state.json')
    writeFileSync(filePath, '{"ok":true}')

    fsyncFileSync(filePath)

    expect(openedFlags).toContain('r+')
    expect(openedFlags).not.toContain('r')
  })
})
