import type { TerminalRuntimeStartupCapability } from './terminal-runtime-startup-capability'

let capability: TerminalRuntimeStartupCapability | null = null

export function installTerminalRuntimeStartupCapability(
  nextCapability: TerminalRuntimeStartupCapability
): void {
  capability = nextCapability
}

export function getTerminalRuntimeStartupCapability(): TerminalRuntimeStartupCapability {
  if (!capability) {
    throw new Error('Terminal-runtime capability must be initialized before use')
  }
  return capability
}

export function getTerminalRuntimeStartupCapabilityIfInstalled(): TerminalRuntimeStartupCapability | null {
  return capability
}
