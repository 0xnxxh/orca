export const WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON =
  'windows-legacy-pty-shutdown-unsafe' as const

export type PtyShutdownBlockReason = typeof WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON
