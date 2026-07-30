import { describe, expect, it } from 'vitest'
import { getRenderedSetupScriptPromptState } from './setup-script-prompt-render-state'
import type { SetupScriptPromptInspection } from '@/lib/setup-script-prompt'
import { getRepoHostIdentityForParts } from '@/store/slices/repo-host-identity'

function repoIdentity(repoId: string, hostId: string): string {
  return getRepoHostIdentityForParts(repoId, hostId)
}

function prompt(
  repoId: string,
  hostId: string
): SetupScriptPromptInspection & { repoHostIdentity: string } {
  return {
    status: 'ok',
    repoId,
    repoHostIdentity: repoIdentity(repoId, hostId),
    hasEffectiveSetup: false,
    hasSharedHooks: false,
    candidate: null
  }
}

describe('getRenderedSetupScriptPromptState', () => {
  it('uses the current inspection when it belongs to the active repo and host', () => {
    const current = prompt('repo-local', 'local')

    expect(
      getRenderedSetupScriptPromptState({
        promptState: current,
        activeRepoId: 'repo-local',
        activeRepoHostIdentity: repoIdentity('repo-local', 'local'),
        lastVisiblePrompt: {
          state: prompt('repo-ssh', 'ssh:windows')
        }
      })
    ).toBe(current)
  })

  it('keeps the previous visible prompt during same-host inspection refresh', () => {
    const previous = prompt('repo-local', 'local')

    expect(
      getRenderedSetupScriptPromptState({
        promptState: null,
        activeRepoId: 'repo-local',
        activeRepoHostIdentity: repoIdentity('repo-local', 'local'),
        lastVisiblePrompt: { state: previous }
      })
    ).toBe(previous)
  })

  it('does not keep a stale prompt when switching hosts in the same project', () => {
    expect(
      getRenderedSetupScriptPromptState({
        promptState: null,
        activeRepoId: 'repo-windows',
        activeRepoHostIdentity: repoIdentity('repo-windows', 'runtime:windows'),
        lastVisiblePrompt: {
          state: prompt('repo-local', 'local')
        }
      })
    ).toBeNull()
  })

  it('does not reuse a matching repo id from a different host', () => {
    expect(
      getRenderedSetupScriptPromptState({
        promptState: prompt('repo-orca', 'local'),
        activeRepoId: 'repo-orca',
        activeRepoHostIdentity: repoIdentity('repo-orca', 'runtime:windows'),
        lastVisiblePrompt: null
      })
    ).toBeNull()
  })

  it('does not keep a stale prompt when switching to a different project', () => {
    expect(
      getRenderedSetupScriptPromptState({
        promptState: null,
        activeRepoId: 'repo-other',
        activeRepoHostIdentity: repoIdentity('repo-other', 'local'),
        lastVisiblePrompt: {
          state: prompt('repo-local', 'local')
        }
      })
    ).toBeNull()
  })
})
