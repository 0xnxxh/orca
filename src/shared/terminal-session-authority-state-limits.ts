import { assertSafeInteger } from './terminal-session-authority-record-validation'

export type TerminalSessionAuthorityStateOptions = Readonly<{
  maxConsumers?: number
  maxRetainedOperationEntries?: number
  maxRetainedOperationBytes?: number
  maxPendingAllocations?: number
  maxPaneRecords?: number
  maxLegacyMigrations?: number
  maxLegacyWorkers?: number
  maxLegacyRecoveryRows?: number
}>

export const TERMINAL_AUTHORITY_STATE_DEFAULT_LIMITS = Object.freeze({
  consumers: 256,
  retainedOperationEntries: 16_384,
  retainedOperationBytes: 64 * 1024 * 1024,
  pendingAllocations: 4_096,
  paneRecords: 16_384,
  legacyMigrations: 512,
  legacyWorkers: 256,
  legacyRecoveryRows: 16_384
})

export type TerminalSessionAuthorityStateLimits = Readonly<
  Record<keyof typeof TERMINAL_AUTHORITY_STATE_DEFAULT_LIMITS, number>
>

export function resolveTerminalAuthorityStateLimits(
  options: TerminalSessionAuthorityStateOptions
): TerminalSessionAuthorityStateLimits {
  return Object.freeze({
    consumers: resolveLimit(options.maxConsumers, 'consumers'),
    retainedOperationEntries: resolveLimit(
      options.maxRetainedOperationEntries,
      'retainedOperationEntries'
    ),
    retainedOperationBytes: resolveLimit(
      options.maxRetainedOperationBytes,
      'retainedOperationBytes'
    ),
    pendingAllocations: resolveLimit(options.maxPendingAllocations, 'pendingAllocations'),
    paneRecords: resolveLimit(options.maxPaneRecords, 'paneRecords'),
    legacyMigrations: resolveLimit(options.maxLegacyMigrations, 'legacyMigrations'),
    legacyWorkers: resolveLimit(options.maxLegacyWorkers, 'legacyWorkers'),
    legacyRecoveryRows: resolveLimit(options.maxLegacyRecoveryRows, 'legacyRecoveryRows')
  })
}

function resolveLimit(
  value: number | undefined,
  key: keyof typeof TERMINAL_AUTHORITY_STATE_DEFAULT_LIMITS
): number {
  const selected = value ?? TERMINAL_AUTHORITY_STATE_DEFAULT_LIMITS[key]
  assertSafeInteger(selected, 'authority capacity', 1)
  return selected
}
