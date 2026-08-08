import type { LegacyPhysicalWorkerRegistry } from './legacy-physical-worker-registry'

export type LegacyPhysicalWorkerAuthorityRoute = Readonly<{
  ownerIncarnationId: string
  routeId: string
}>

export function preserveLegacyPhysicalWorkerAuthorityRoutes(
  registry: LegacyPhysicalWorkerRegistry,
  routes: readonly LegacyPhysicalWorkerAuthorityRoute[]
): void {
  for (const route of routes) {
    const result = registry.preserve(route)
    if (result.status !== 'preserved') {
      throw new Error(`legacy physical worker authority preservation failed: ${result.status}`)
    }
  }
}
