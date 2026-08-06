import type { LocalPtyProvider } from '../providers/local-pty-provider'

export function handleLocalPtyRendererLoad(
  provider: LocalPtyProvider,
  webContentsId: number,
  isRecoveryReloadInFlight?: (webContentsId: number) => boolean
): void {
  const generation = provider.advanceGeneration()
  if (isRecoveryReloadInFlight?.(webContentsId)) {
    return
  }
  provider.killOrphanedPtys(generation - 1)
}
