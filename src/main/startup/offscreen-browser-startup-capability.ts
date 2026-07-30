import type { BrowserManager } from '../browser/browser-manager'
import { OffscreenBrowserBackend } from '../browser/offscreen-browser-backend'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

type OffscreenBrowserStartupRuntime = Pick<OrcaRuntimeService, 'setOffscreenBrowserBackend'>

export function attachOffscreenBrowserStartupCapability(
  runtime: OffscreenBrowserStartupRuntime,
  browserManager: BrowserManager
): OffscreenBrowserBackend {
  const backend = new OffscreenBrowserBackend(browserManager)
  runtime.setOffscreenBrowserBackend(backend)
  return backend
}
