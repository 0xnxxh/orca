import { app } from 'electron'
import { join } from 'node:path'

let openCodeUsageFilePath: string | null = null

export function initOpenCodeUsagePath(): void {
  // Why: app.setName can change userData casing, so capture the configured path before app readiness.
  openCodeUsageFilePath = join(app.getPath('userData'), 'orca-opencode-usage.json')
}

export function getOpenCodeUsageFilePath(): string {
  if (!openCodeUsageFilePath) {
    openCodeUsageFilePath = join(app.getPath('userData'), 'orca-opencode-usage.json')
  }
  return openCodeUsageFilePath
}
