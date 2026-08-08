export function resolveLegacyPhysicalWorkerSessionLimit(
  value: number | undefined,
  fallback: number
): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > 4_096) {
    throw new Error('legacy physical PTY session limit is invalid')
  }
  return selected
}
