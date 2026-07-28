export type HostScreenShellOperations = {
  leaveHost(): void
  navigateFromHostList(target: string): void
  openExternalUrl(url: string): Promise<void>
  reconnect(): Promise<void>
  repairPairing(): void
  removeHost(hostPublicKey: string): Promise<void>
}
