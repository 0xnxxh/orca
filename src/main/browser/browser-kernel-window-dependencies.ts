import type { BrowserManager } from './browser-manager'

export type BrowserKernelWindowDependencies = {
  browserManager: BrowserManager
  isAllowedSessionPartition: (partition: string) => boolean
}

let dependencies: BrowserKernelWindowDependencies | null = null

export function setBrowserKernelWindowDependencies(
  nextDependencies: BrowserKernelWindowDependencies
): void {
  dependencies = nextDependencies
}

export function getBrowserKernelWindowDependencies(): BrowserKernelWindowDependencies {
  if (!dependencies) {
    throw new Error('Browser kernel must be initialized before creating or attaching a window')
  }
  return dependencies
}
