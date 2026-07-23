import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chunkWorktreeIncludePathspecs,
  listGitignoredEntries
} from './worktree-include-git-enumeration'
import { gitExecFileAsync } from './runner'

vi.mock('./runner', () => ({
  gitExecFileAsync: vi.fn()
}))

const gitExecFileAsyncMock = vi.mocked(gitExecFileAsync)

beforeEach(() => {
  gitExecFileAsyncMock.mockReset()
})

describe('chunkWorktreeIncludePathspecs', () => {
  it('keeps shared exclusions when they fit the Windows-safe command budget', () => {
    expect(
      chunkWorktreeIncludePathspecs([':(glob)**/.env'], [':(exclude,literal)node_modules'])
    ).toEqual([[':(glob)**/.env', ':(exclude,literal)node_modules']])
  })

  it('keeps targeted scans when shared exclusions exceed the command budget', () => {
    const exclusions = Array.from(
      { length: 1_000 },
      (_, index) => `:(exclude,literal)generated-${index}`
    )

    expect(chunkWorktreeIncludePathspecs([':(glob)**/.env'], exclusions)).toEqual([
      [':(glob)**/.env']
    ])
  })
})

describe('listGitignoredEntries', () => {
  it('parses bounded Git output lazily so caller budgets can stop allocation', async () => {
    gitExecFileAsyncMock.mockResolvedValue({
      stdout: 'cache/\0.env\0nested/.env\0',
      stderr: ''
    })

    const entries = await listGitignoredEntries(
      '/repo',
      {},
      {
        collapseDirectories: true,
        timeout: 250
      }
    )

    expect(Array.isArray(entries)).toBe(false)
    const iterator = entries[Symbol.iterator]()
    expect(iterator.next()).toEqual({
      done: false,
      value: { relativePath: 'cache', isDirectory: true, coversDescendants: true }
    })
    expect(Array.from(iterator)).toEqual([
      { relativePath: '.env', isDirectory: false, coversDescendants: false },
      { relativePath: 'nested/.env', isDirectory: false, coversDescendants: false }
    ])
  })
})
