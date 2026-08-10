import type { PtyProcessInfo } from '../providers/pty-process-info'
import { listLiveDaemonProcesses } from '../daemon/daemon-init'
import { wslHookRelayManager } from './wsl-hook-relay-manager'
import { wslHookRelayStateKey } from './wsl-hook-relay-state-key'
import { listRunningWslDistros } from './wsl-hook-relay-launch'

type StartupReconciliationDeps = {
  platform: NodeJS.Platform
  listLiveProcesses: () => Promise<PtyProcessInfo[] | null>
  listRunningDistros: () => Promise<string[] | null>
  ensureForDistro: (distro: string) => Promise<void>
}

const defaultDeps: StartupReconciliationDeps = {
  platform: process.platform,
  listLiveProcesses: listLiveDaemonProcesses,
  listRunningDistros: listRunningWslDistros,
  ensureForDistro: (distro) => wslHookRelayManager.ensureRunningDistroForStartup(distro)
}

export async function reconcileWslHookRelaysOnStartup(
  deps: Partial<StartupReconciliationDeps> = {}
): Promise<void> {
  const io = { ...defaultDeps, ...deps }
  if (io.platform !== 'win32') {
    return
  }
  const processes = await io.listLiveProcesses()
  if (!processes) {
    return
  }
  const distros = new Map<string, string>()
  for (const process of processes) {
    if (typeof process.wslDistro !== 'string') {
      continue
    }
    const distro = process.wslDistro.trim()
    const key = wslHookRelayStateKey(distro)
    if (distro && !distros.has(key)) {
      distros.set(key, distro)
    }
  }
  if (distros.size === 0) {
    return
  }
  const runningSnapshot = await io.listRunningDistros()
  if (!runningSnapshot) {
    return
  }
  const runningKeys = new Set(runningSnapshot.map(wslHookRelayStateKey))
  await Promise.all(
    [...distros].flatMap(([key, distro]) =>
      runningKeys.has(key) ? [io.ensureForDistro(distro)] : []
    )
  )
}
