import type { GlobalSettings } from './types'
import { normalizeGlobalWindowsRuntimeDefault } from './project-execution-runtime'

export type LocalAccountRuntimeTarget = {
  runtime: 'host' | 'wsl'
  wslDistro: string | null
}

type LocalAccountRuntimeSettings = Pick<
  GlobalSettings,
  'localAccountRuntime' | 'localAccountWslDistro' | 'localWindowsRuntimeDefault'
>

/**
 * Resolves where provider accounts are inspected (Windows host vs a WSL distro).
 *
 * `'host'`/`'wsl'` are explicit pins; `'auto'` (the default) follows the global
 * Windows runtime default so a WSL project surfaces WSL accounts instead of the
 * Windows-host ones. Non-Windows platforms have no WSL, so always resolve host.
 */
export function resolveLocalAccountRuntimeTarget(
  settings: LocalAccountRuntimeSettings,
  platform: NodeJS.Platform = process.platform
): LocalAccountRuntimeTarget {
  if (settings.localAccountRuntime === 'host') {
    return { runtime: 'host', wslDistro: null }
  }
  if (settings.localAccountRuntime === 'wsl') {
    return { runtime: 'wsl', wslDistro: normalizeDistro(settings.localAccountWslDistro) }
  }

  // 'auto' (or any unset legacy value): follow the global Windows runtime default.
  if (platform !== 'win32') {
    return { runtime: 'host', wslDistro: null }
  }
  const runtimeDefault = normalizeGlobalWindowsRuntimeDefault(settings.localWindowsRuntimeDefault)
  if (runtimeDefault.kind === 'wsl') {
    return { runtime: 'wsl', wslDistro: runtimeDefault.distro }
  }
  return { runtime: 'host', wslDistro: null }
}

function normalizeDistro(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
