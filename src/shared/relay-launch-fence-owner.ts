import { randomUUID } from 'node:crypto'

export const RELAY_LAUNCH_FENCE_OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/u

export function relayInstallLockOwnerFileName(ownerToken: string): string {
  assertRelayLaunchFenceOwnerToken(ownerToken)
  return `.install-owner-${ownerToken}`
}

export function relayGcClaimOwnerFileName(ownerToken: string): string {
  assertRelayLaunchFenceOwnerToken(ownerToken)
  return `.gc-owner-${ownerToken}`
}

export function isRelayLaunchFenceOwnerToken(value: string): boolean {
  return RELAY_LAUNCH_FENCE_OWNER_TOKEN_PATTERN.test(value)
}

export function createRelayInstallLockOwnerToken(): string {
  return `install-${process.pid}-${Date.now()}-${randomUUID()}`
}

function assertRelayLaunchFenceOwnerToken(ownerToken: string): void {
  if (!isRelayLaunchFenceOwnerToken(ownerToken)) {
    throw new Error('relay launch fence owner token is invalid')
  }
}
