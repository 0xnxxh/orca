import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ walk: vi.fn() }))

vi.mock('../ai-vault/session-scanner-discovery', () => ({
  walkSessionFiles: mocks.walk
}))

import { findWslSessionPath } from './wsl-session-path-scan'

beforeEach(() => {
  mocks.walk.mockReset()
})

describe('WSL session path scans', () => {
  it('matches Claude session names in UNC paths on every host platform', async () => {
    const transcript =
      '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.claude\\projects\\-home-ada-repo\\session-id.jsonl'
    mocks.walk.mockImplementation(
      (
        _root: string,
        _agent: string,
        _issues: unknown[],
        options: { filePredicate?: (path: string) => boolean }
      ) => Promise.resolve([transcript].filter((path) => options.filePredicate?.(path)))
    )

    await expect(
      findWslSessionPath(
        'claude',
        '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.claude\\projects',
        'session-id'
      )
    ).resolves.toBe(transcript)
  })
})
