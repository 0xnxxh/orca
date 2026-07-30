import type { CodexLaunchSessionStartupCapability } from './codex-launch-session-startup-capability'

let capability: CodexLaunchSessionStartupCapability | null = null

export function installCodexLaunchSessionStartupCapability(
  nextCapability: CodexLaunchSessionStartupCapability
): void {
  capability = nextCapability
}

export function getCodexLaunchSessionStartupCapability(): CodexLaunchSessionStartupCapability {
  if (!capability) {
    throw new Error('Codex launch/session capability must be initialized before use')
  }
  return capability
}
