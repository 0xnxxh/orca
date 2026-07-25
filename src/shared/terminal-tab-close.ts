// Why: all inner deadlines need delivery margin below the tightest real caller (paired web at 15s).
export const TERMINAL_TAB_PROVIDER_TEARDOWN_TIMEOUT_MS = 10_000
export const TERMINAL_TAB_PROVIDER_RPC_TIMEOUT_MS = 12_000
export const TERMINAL_TAB_CLOSE_RESPONSE_TIMEOUT_MS = 14_000
export const TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS = 15_000

export type TerminalTabCloseRequest = {
  requestId: string
  tabId: string
}

export type TerminalTabCloseResponse = {
  requestId: string
  error?: string
}
