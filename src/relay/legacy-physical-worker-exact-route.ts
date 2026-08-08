import type { LegacyPhysicalWorkerClient } from './legacy-physical-worker-client'

export type LegacyPhysicalWorkerExactRoute = Readonly<{
  client: LegacyPhysicalWorkerClient
  generation: number
  isCurrent: () => boolean
}>
