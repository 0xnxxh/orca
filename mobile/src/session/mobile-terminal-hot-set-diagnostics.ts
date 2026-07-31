import {
  logMobileTerminalDiagnostic,
  shortenMobileTerminalDiagnosticId
} from './mobile-terminal-diagnostics'

export type MobileTerminalColdRevealBoundary =
  | 'activation'
  | 'webview-mount'
  | 'webview-ready'
  | 'stream-armed'
  | 'first-scrollback'
  | 'init-ready'
  | 'render-ready'

export function recordMobileTerminalColdRevealBoundary(
  handle: string,
  revision: number,
  boundary: MobileTerminalColdRevealBoundary
): void {
  logMobileTerminalDiagnostic('cold-reveal-boundary', {
    handle: shortenMobileTerminalDiagnosticId(handle),
    revision,
    boundary,
    atMs: Date.now()
  })
}

export function recordMobileTerminalHotSetEviction(handle: string): void {
  logMobileTerminalDiagnostic('hot-set-evicted', {
    handle: shortenMobileTerminalDiagnosticId(handle)
  })
}

export function recordMobileTerminalHotSetFailOpen(reason: string | null): void {
  if (!reason) {
    return
  }
  logMobileTerminalDiagnostic('hot-set-failed-open', { reason })
}
