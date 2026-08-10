/** Compact "how long ago" label for cleanup rows; 0 means Orca never recorded it. */
export function formatWorkspaceCleanupRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) {
    return 'Never'
  }
  const deltaMs = now - timestamp
  if (deltaMs < 60_000) {
    return 'Just now'
  }
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return `${hours}h ago`
  }
  return `${Math.floor(hours / 24)}d ago`
}
