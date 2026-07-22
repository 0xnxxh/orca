import { describe, expect, it } from 'vitest'
import { chunkWorktreeIncludePathspecs } from './worktree-include-git-enumeration'

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
