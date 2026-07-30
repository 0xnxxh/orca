import { app } from 'electron'
import { join } from 'node:path'

let statsFilePath: string | null = null

export function initStatsPath(): void {
  // Why: app.setName can change userData casing, so capture the configured path before app readiness.
  statsFilePath = join(app.getPath('userData'), 'orca-stats.json')
}

export function getStatsFilePath(): string {
  if (!statsFilePath) {
    statsFilePath = join(app.getPath('userData'), 'orca-stats.json')
  }
  return statsFilePath
}
