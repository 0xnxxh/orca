import { app } from 'electron'
import { join } from 'node:path'

let claudeUsageFilePath: string | null = null

export function initClaudeUsagePath(): void {
  // Why: app.setName can change userData casing, so capture the configured path before app readiness.
  claudeUsageFilePath = join(app.getPath('userData'), 'orca-claude-usage.json')
}

export function getClaudeUsageFilePath(): string {
  if (!claudeUsageFilePath) {
    claudeUsageFilePath = join(app.getPath('userData'), 'orca-claude-usage.json')
  }
  return claudeUsageFilePath
}
