export type LegacyPhysicalWorkerLifecycle = Readonly<{
  lifecycleHoldCount: number
}>

export function legacyPhysicalWorkerRelayState(input: {
  localActivePtyCount: number
  pendingPtyCreationCount: number
  lifecycle?: LegacyPhysicalWorkerLifecycle | null
}): Readonly<{ protectedPtyCount: number; idle: boolean }> {
  const lifecycleHoldCount = input.lifecycle?.lifecycleHoldCount ?? 0
  return Object.freeze({
    protectedPtyCount: input.localActivePtyCount + lifecycleHoldCount,
    idle:
      input.localActivePtyCount === 0 &&
      input.pendingPtyCreationCount === 0 &&
      lifecycleHoldCount === 0
  })
}
