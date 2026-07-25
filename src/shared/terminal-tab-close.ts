export const TERMINAL_TAB_PROVIDER_TEARDOWN_TIMEOUT_MS = 30_000
export const TERMINAL_TAB_PROVIDER_RPC_TIMEOUT_MS = 35_000
export const TERMINAL_TAB_CLOSE_RESPONSE_TIMEOUT_MS = 40_000

export type TerminalTabCloseRequest = {
  requestId: string
  tabId: string
}

export type TerminalTabCloseResponse = {
  requestId: string
  error?: string
}
