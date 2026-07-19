import { runMacUpdateInstallFenceStartupGate } from './startup/mac-update-install-fence-gate'

// Why: static imports execute before module statements. Keeping the real main
// graph dynamic makes this fence run before profile or runtime side effects.
if (runMacUpdateInstallFenceStartupGate()) {
  void import('./application-main').catch((error: unknown) => {
    // Why: a swallowed load failure leaves a headless process with no window
    // and no signal; exit non-zero so launchd/CLI callers see the failure.
    process.stderr.write(`[startup] Failed to load the application module: ${String(error)}\n`)
    process.exit(1)
  })
}
