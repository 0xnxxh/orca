import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashWorktreeId } from '../main/terminal-history-id'
import { deleteRelayHistory, injectRelayHistoryEnv } from './terminal-history'

const worktreeId = 'relay-test::/remote/worktree'
const historyDir = join(homedir(), '.orca-remote', 'terminal-history', hashWorktreeId(worktreeId))

afterEach(() => rmSync(historyDir, { recursive: true, force: true }))

describe('relay shell history', () => {
  it.each(['/bin/bash', '/usr/bin/zsh'])('scopes %s without replacing caller HISTFILE', (shell) => {
    const env: Record<string, string> = {}
    const dir = injectRelayHistoryEnv(env, worktreeId, shell)
    expect(dir).toBe(historyDir)
    expect(env.HISTFILE).toBe(
      join(historyDir, shell.endsWith('bash') ? 'bash_history' : 'zsh_history')
    )

    const custom = { HISTFILE: '/custom/history' }
    expect(injectRelayHistoryEnv(custom, worktreeId, shell)).toBeNull()
    expect(custom.HISTFILE).toBe('/custom/history')
  })

  it('does not scope unsupported shells and cleans up idempotently', () => {
    const env: Record<string, string> = {}
    expect(injectRelayHistoryEnv(env, worktreeId, '/bin/fish')).toBeNull()
    deleteRelayHistory(worktreeId)
    deleteRelayHistory(worktreeId)
    expect(existsSync(historyDir)).toBe(false)
  })
})
