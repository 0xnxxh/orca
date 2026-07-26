export const MAX_TIMER_DELAY_MS = 2_147_483_647

export function isSafeTimerDelayMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TIMER_DELAY_MS
  )
}

export function parsePositiveSafeIntegerText(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
