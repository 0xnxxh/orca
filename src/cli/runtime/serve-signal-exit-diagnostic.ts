import { RuntimeClientError } from './types'

export const MAC_CRASH_REPORT_GLOB = '~/Library/Logs/DiagnosticReports/Orca-*.ips'

export function serveSignalExitError(
  signal: NodeJS.Signals | null,
  platform: NodeJS.Platform = process.platform
): RuntimeClientError {
  if (!signal) {
    return new RuntimeClientError(
      'runtime_serve_failed',
      'Orca serve exited without reporting an exit code or signal.'
    )
  }
  if (platform !== 'darwin' || signal !== 'SIGABRT') {
    return new RuntimeClientError('runtime_serve_failed', `Orca serve exited via ${signal}.`)
  }
  // Why: this abort happens inside +[NSApplication sharedApplication], before any of our JS runs,
  // so the parent CLI is the only place the failure can be explained at all.
  return new RuntimeClientError(
    'runtime_serve_failed',
    'Orca serve exited via SIGABRT during macOS application startup. This usually means the process could not register with the macOS window server, which is common in restricted or sandboxed environments, SSH sessions without a GUI login, and CI.',
    {
      nextSteps: [
        'Run `orca serve` from a normal terminal session on the Mac desktop.',
        `Look for a crash report at ${MAC_CRASH_REPORT_GLOB}.`
      ]
    }
  )
}
