let quittingForUpdate = false

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}

export function markUpdateInstallQuitInProgress(): void {
  quittingForUpdate = true
}

export function clearUpdateInstallQuitInProgress(): void {
  quittingForUpdate = false
}
