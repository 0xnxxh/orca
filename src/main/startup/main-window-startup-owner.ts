import type { MainWindowStartupCapability } from './main-window-startup-capability'

let capability: MainWindowStartupCapability | null = null

export function installMainWindowStartupCapability(
  nextCapability: MainWindowStartupCapability
): void {
  capability = nextCapability
}

export function getMainWindowStartupCapability(): MainWindowStartupCapability {
  if (!capability) {
    throw new Error('Main-window capability must be initialized before use')
  }
  return capability
}
