import type { TabActivationIntent } from '../../../src/shared/tab-activation-intent'
import type { RpcClient } from '../transport/rpc-client'
import { LogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import type { RpcResponse } from '../transport/types'
import { logMobileTerminalDiagnostic } from './mobile-terminal-diagnostics'

type ActivationClient = Pick<RpcClient, 'sendRequest'>

type MobileSessionTabActivationParams = {
  worktree: string
  tabId: string
  leafId?: string
  notifyClients: false
  navigation: 'caller'
  /** Required so each call site declares whether a user asked for this. */
  intent: TabActivationIntent
}

async function retryIdempotentActivationAfterCutover(
  request: () => Promise<RpcResponse>,
  operation: 'terminal.focus' | 'session.tabs.activate'
): Promise<RpcResponse> {
  const terminal = operation === 'terminal.focus'
  logMobileTerminalDiagnostic('activation-request', { terminal })
  try {
    const response = await request()
    logMobileTerminalDiagnostic('activation-result', {
      terminal,
      ok: response.ok
    })
    return response
  } catch (error) {
    if (!(error instanceof LogicalClientCutoverError)) {
      logMobileTerminalDiagnostic('activation-error', {
        terminal,
        isErrorObject: error instanceof Error
      })
      throw error
    }
    logMobileTerminalDiagnostic('activation-cutover-retry', {
      terminal
    })
    // Why: cutover rejects ambiguous in-flight work after the replacement is
    // active; these state-setting requests are idempotent and safe to repeat once.
    try {
      const response = await request()
      logMobileTerminalDiagnostic('activation-result', {
        terminal,
        ok: response.ok
      })
      return response
    } catch (retryError) {
      logMobileTerminalDiagnostic('activation-error', {
        terminal,
        isErrorObject: retryError instanceof Error
      })
      throw retryError
    }
  }
}

export function focusMobileTerminal(
  client: ActivationClient,
  terminal: string
): Promise<RpcResponse> {
  return retryIdempotentActivationAfterCutover(
    () => client.sendRequest('terminal.focus', { terminal, navigation: 'host' }),
    'terminal.focus'
  )
}

export function activateMobileSessionTab(
  client: ActivationClient,
  params: MobileSessionTabActivationParams
): Promise<RpcResponse> {
  return retryIdempotentActivationAfterCutover(
    () => client.sendRequest('session.tabs.activate', params),
    'session.tabs.activate'
  )
}
