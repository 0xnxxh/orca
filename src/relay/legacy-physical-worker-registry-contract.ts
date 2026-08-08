export const MAX_LEGACY_PHYSICAL_WORKERS = 64
export const ABSOLUTE_MAX_LEGACY_PHYSICAL_WORKERS = 256

export function assertLegacyPhysicalWorkerRegistryCapacity(capacity: number): void {
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > ABSOLUTE_MAX_LEGACY_PHYSICAL_WORKERS
  ) {
    throw new Error('legacy physical worker registry capacity is invalid')
  }
}

export type LegacyPhysicalWorkerRegistrationResult =
  | Readonly<{ status: 'registered'; replaced: boolean }>
  | Readonly<{ status: 'unsupported'; reason: string }>
  | Readonly<{ status: 'conflict'; routeId: string }>
  | Readonly<{ status: 'capacity' }>

export type LegacyPhysicalWorkerPreservation = Readonly<{
  ownerIncarnationId: string
  routeId: string
}>

export type LegacyPhysicalWorkerPreservationResult =
  | Readonly<{ status: 'preserved'; alreadyPresent: boolean }>
  | Readonly<{ status: 'conflict'; routeId: string }>
  | Readonly<{ status: 'capacity' }>

export type LegacyPhysicalWorkerLifecycleCounts = Readonly<{
  activeWorkerCount: number
  pendingWorkerCount: number
  lifecycleHoldCount: number
}>

export function assertLegacyPhysicalWorkerPreservation(
  obligation: LegacyPhysicalWorkerPreservation
): void {
  if (!obligation.ownerIncarnationId || !obligation.routeId) {
    throw new Error('legacy physical worker preservation identity is invalid')
  }
}
