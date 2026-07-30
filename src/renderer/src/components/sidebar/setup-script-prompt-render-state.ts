import type { SetupScriptPromptInspection } from '@/lib/setup-script-prompt'

export type SetupScriptPromptState = SetupScriptPromptInspection & {
  repoHostIdentity: string
}

export type LastVisibleSetupScriptPrompt = {
  state: SetupScriptPromptState
}

export function markSetupScriptPromptSaved(
  current: SetupScriptPromptState | null,
  savedRepoHostIdentity: string
): SetupScriptPromptState | null {
  return current?.repoHostIdentity === savedRepoHostIdentity && current.status === 'ok'
    ? { ...current, hasEffectiveSetup: true }
    : current
}

export function getRenderedSetupScriptPromptState(input: {
  promptState: SetupScriptPromptState | null
  activeRepoId: string
  activeRepoHostIdentity: string
  lastVisiblePrompt: LastVisibleSetupScriptPrompt | null
}): SetupScriptPromptState | null {
  const { activeRepoHostIdentity, activeRepoId, lastVisiblePrompt, promptState } = input
  if (
    promptState?.repoId === activeRepoId &&
    promptState.repoHostIdentity === activeRepoHostIdentity
  ) {
    return promptState
  }
  return !promptState && lastVisiblePrompt?.state.repoHostIdentity === activeRepoHostIdentity
    ? lastVisiblePrompt.state
    : null
}
