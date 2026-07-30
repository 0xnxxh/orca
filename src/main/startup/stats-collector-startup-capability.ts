import { StatsCollector } from '../stats/collector'

export function createStatsCollectorStartupCapability(): StatsCollector {
  return new StatsCollector()
}
