export const MACOS_PTY_LIMIT_DEFAULT = 511
export const MACOS_PTY_LIMIT_MAXIMUM = 999

export type MacosPtyLimitAvailableStatus = {
  state: 'available'
  currentLimit: number
  defaultLimit: number
  maximumLimit: number
}

export type MacosPtyLimitStatus =
  | MacosPtyLimitAvailableStatus
  | { state: 'unsupported' }
  | { state: 'unavailable' }

export type MacosPtyLimitIncreaseResult =
  | {
      outcome: 'increased' | 'already-maximum'
      status: MacosPtyLimitAvailableStatus
    }
  | { outcome: 'cancelled' | 'unsupported' | 'failed' }
