import type { DesktopShellStartupCapability } from './desktop-shell-startup-capability'

let capability: DesktopShellStartupCapability | null = null

export function installDesktopShellStartupCapability(
  nextCapability: DesktopShellStartupCapability
): void {
  capability = nextCapability
}

export function getDesktopShellStartupCapability(): DesktopShellStartupCapability {
  if (!capability) {
    throw new Error('Desktop-shell capability must be initialized before use')
  }
  return capability
}

export function getDesktopShellStartupCapabilityIfInstalled(): DesktopShellStartupCapability | null {
  return capability
}
