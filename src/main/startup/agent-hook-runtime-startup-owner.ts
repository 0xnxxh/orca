import type { AgentHookRuntimeStartupCapability } from './agent-hook-runtime-startup-capability'

let capability: AgentHookRuntimeStartupCapability | null = null

export function installAgentHookRuntimeStartupCapability(
  nextCapability: AgentHookRuntimeStartupCapability
): void {
  capability = nextCapability
}

export function getAgentHookRuntimeStartupCapability(): AgentHookRuntimeStartupCapability {
  if (!capability) {
    throw new Error('Agent-hook runtime capability must be initialized before use')
  }
  return capability
}

export function getAgentHookRuntimeStartupCapabilityIfInstalled(): AgentHookRuntimeStartupCapability | null {
  return capability
}
