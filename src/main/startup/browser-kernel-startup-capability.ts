import { browserCertificateTrustController, browserManager } from '../browser/browser-manager'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import { initializeBrowserSessionsForApp } from '../browser/browser-session-startup'
import { setBrowserKernelWindowDependencies } from '../browser/browser-kernel-window-dependencies'

export function createBrowserKernelStartupCapability() {
  setBrowserKernelWindowDependencies({
    browserManager,
    isAllowedSessionPartition: (partition) => browserSessionRegistry.isAllowedPartition(partition)
  })
  return {
    browserCertificateTrustController,
    browserManager,
    initializeBrowserSessionsForApp
  }
}
