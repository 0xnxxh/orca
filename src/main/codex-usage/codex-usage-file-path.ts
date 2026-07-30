import { app } from 'electron'
import { join } from 'node:path'

let codexUsageFilePath: string | null = null

export function initCodexUsagePath(): void {
  // Why: app.setName can change userData casing, so capture the configured path before app readiness.
  codexUsageFilePath = join(app.getPath('userData'), 'orca-codex-usage.json')
}

export function getCodexUsageFilePath(): string {
  if (!codexUsageFilePath) {
    codexUsageFilePath = join(app.getPath('userData'), 'orca-codex-usage.json')
  }
  return codexUsageFilePath
}
