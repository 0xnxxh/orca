import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  fishRequirementViolation,
  resolveFishBinary
} from '../../../shared/fish-binary-requirement'
import { quoteStartupArg } from '../../../shared/tui-agent-startup-shell'

vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))
vi.mock('@/lib/client-login-shell', () => ({
  getClientLoginShell: () => '/opt/homebrew/bin/fish'
}))

import { buildAiVaultResumeCopyCommandForWorktree } from './ai-vault-resume-command'

const FISH = resolveFishBinary(4)
const itWithFish = FISH.available ? it : it.skip

let root: string | null = null

function fishEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = root as string
  return {
    PATH: `${home}${path.delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: home,
    USER: 'orca-fish-test',
    LOGNAME: 'orca-fish-test',
    XDG_CONFIG_HOME: home,
    XDG_DATA_HOME: path.join(home, 'data'),
    TERM: 'dumb',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    ...overrides
  }
}

function runFish(command: string, env: NodeJS.ProcessEnv = fishEnv()): Buffer {
  return execFileSync(FISH.path as string, ['-c', command], {
    cwd: root as string,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function setUniversalHomes(): void {
  runFish('set -Ux CODEX_HOME universal-codex; set -Ux ORCA_CODEX_HOME universal-orca')
}

function exportedHomes(): Record<string, string | undefined> {
  const env = runFish('/usr/bin/env').toString('utf8')
  return Object.fromEntries(
    env
      .split('\n')
      .filter((line) => /^(CODEX_HOME|ORCA_CODEX_HOME)=/.test(line))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
}

function installCodexCapture(): string {
  const capturePath = path.join(root as string, 'codex-env.json')
  const codexPath = path.join(root as string, 'codex')
  writeFileSync(
    codexPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
      '  codexHome: process.env.CODEX_HOME ?? null,',
      '  orcaCodexHome: process.env.ORCA_CODEX_HOME ?? null,',
      "  hasCodexHome: Object.hasOwn(process.env, 'CODEX_HOME'),",
      "  hasOrcaCodexHome: Object.hasOwn(process.env, 'ORCA_CODEX_HOME'),",
      '  argv: process.argv.slice(2)',
      '}))',
      ''
    ].join('\n')
  )
  chmodSync(codexPath, 0o755)
  return capturePath
}

function makeState(): Parameters<typeof buildAiVaultResumeCopyCommandForWorktree>[0]['state'] {
  const workspacePath = root as string
  return {
    activeRepoId: 'repo-1',
    activeWorktreeId: 'repo-1::worktree-1',
    folderWorkspaces: [],
    projectGroups: [],
    repos: [{ id: 'repo-1', path: workspacePath }],
    projects: [{ id: 'repo-1', sourceRepoIds: ['repo-1'] }],
    settings: {
      agentDefaultArgs: { codex: '' },
      agentDefaultEnv: { codex: {} }
    },
    worktreesByRepo: {
      'repo-1': [
        {
          id: 'repo-1::worktree-1',
          repoId: 'repo-1',
          path: workspacePath
        }
      ]
    }
  } as unknown as AppState
}

describe('Fish real-home Codex resume environment', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'orca-fish-resume-env-'))
  })

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true })
      root = null
    }
  })

  it('has the fish this suite needs when CI requires one', () => {
    expect(fishRequirementViolation(FISH)).toBeNull()
  })

  itWithFish('proves unscoped erase exposes universal values hidden by inherited globals', () => {
    setUniversalHomes()
    const capturePath = installCodexCapture()

    runFish(
      'set -e CODEX_HOME; set -e ORCA_CODEX_HOME; codex',
      fishEnv({ CODEX_HOME: 'orca-route', ORCA_CODEX_HOME: 'orca-route' })
    )

    expect(JSON.parse(readFileSync(capturePath, 'utf8'))).toMatchObject({
      codexHome: 'universal-codex',
      orcaCodexHome: 'universal-orca'
    })
    expect(exportedHomes()).toMatchObject({
      CODEX_HOME: 'universal-codex',
      ORCA_CODEX_HOME: 'universal-orca'
    })
  })

  itWithFish('masks every scope through a Fish function without changing shell state', () => {
    setUniversalHomes()
    const capturePath = installCodexCapture()
    const workspacePath = root as string
    const beforePath = path.join(workspacePath, 'scopes-before.txt')
    const afterPath = path.join(workspacePath, 'scopes-after.txt')
    const command = buildAiVaultResumeCopyCommandForWorktree({
      state: makeState(),
      worktreeId: 'repo-1::worktree-1',
      commandOverride: 'fish_codex --profile wrapped',
      session: {
        agent: 'codex',
        sessionId: 'session one',
        cwd: workspacePath,
        codexHome: null
      }
    })

    runFish(
      [
        'function fish_codex',
        '  command codex --fish-wrapper $argv',
        'end',
        'function run_resume',
        '  set -lx CODEX_HOME local-codex',
        '  set -lx ORCA_CODEX_HOME local-orca',
        `  set -S CODEX_HOME ORCA_CODEX_HOME > ${quoteStartupArg(beforePath, 'fish')}`,
        `  ${command}`,
        `  set -S CODEX_HOME ORCA_CODEX_HOME > ${quoteStartupArg(afterPath, 'fish')}`,
        'end',
        'run_resume'
      ].join('\n'),
      fishEnv({ CODEX_HOME: 'inherited-codex', ORCA_CODEX_HOME: 'inherited-orca' })
    )

    expect(JSON.parse(readFileSync(capturePath, 'utf8'))).toEqual({
      codexHome: '',
      orcaCodexHome: '',
      hasCodexHome: true,
      hasOrcaCodexHome: true,
      argv: ['--fish-wrapper', '--profile', 'wrapped', 'resume', 'session one']
    })
    const scopesBefore = readFileSync(beforePath, 'utf8')
    expect(scopesBefore).toContain('|local-codex|')
    expect(scopesBefore).toContain('|local-orca|')
    expect(scopesBefore).toContain('|inherited-codex|')
    expect(scopesBefore).toContain('|inherited-orca|')
    expect(scopesBefore).toContain('|universal-codex|')
    expect(scopesBefore).toContain('|universal-orca|')
    expect(readFileSync(afterPath, 'utf8')).toBe(scopesBefore)
    expect(exportedHomes()).toMatchObject({
      CODEX_HOME: 'universal-codex',
      ORCA_CODEX_HOME: 'universal-orca'
    })
  })
})
