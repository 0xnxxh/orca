import type { Store } from '../persistence'
import { StarNagService } from '../star-nag/service'
import type { StatsCollector } from '../stats/collector'

export async function createStarNagStartupCapability(
  store: Store,
  stats: StatsCollector
): Promise<StarNagService> {
  const service = new StarNagService(store, stats)
  service.start()
  service.registerIpcHandlers()
  return service
}
