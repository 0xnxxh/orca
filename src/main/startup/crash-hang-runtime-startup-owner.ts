import type { CrashHangRuntimeStartupCapability } from './crash-hang-runtime-startup-capability'

let capability: CrashHangRuntimeStartupCapability | null = null

export function installCrashHangRuntimeStartupCapability(
  nextCapability: CrashHangRuntimeStartupCapability
): void {
  capability = nextCapability
}

export function getCrashHangRuntimeStartupCapability(): CrashHangRuntimeStartupCapability {
  if (!capability) {
    throw new Error('Crash/hang runtime capability must be initialized before use')
  }
  return capability
}

export function getCrashHangRuntimeStartupCapabilityIfInstalled(): CrashHangRuntimeStartupCapability | null {
  return capability
}
