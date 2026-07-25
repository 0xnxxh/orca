import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS,
  TERMINAL_TAB_CLOSE_RESPONSE_TIMEOUT_MS,
  TERMINAL_TAB_PROVIDER_RPC_TIMEOUT_MS,
  TERMINAL_TAB_PROVIDER_TEARDOWN_TIMEOUT_MS
} from './terminal-tab-close'

describe('terminal tab close deadline composition', () => {
  it('fits every inner deadline below the real web, mobile, and short-RPC callers', () => {
    const directMobileRpc = readFileSync(
      join(process.cwd(), 'mobile', 'src', 'transport', 'rpc-client.ts'),
      'utf8'
    )
    const relayMobileRpc = readFileSync(
      join(process.cwd(), 'mobile', 'src', 'transport', 'mobile-relay-rpc-session.ts'),
      'utf8'
    )
    const pairedWebRuntime = readFileSync(
      join(process.cwd(), 'src', 'renderer', 'src', 'runtime', 'web-runtime-session.ts'),
      'utf8'
    )
    const shortRpcSocket = readFileSync(
      join(process.cwd(), 'src', 'main', 'runtime', 'rpc', 'unix-socket-transport.ts'),
      'utf8'
    )
    const pairedWebCallerTimeoutMs = pairedWebRuntime.includes(
      'timeoutMs: TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS'
    )
      ? TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS
      : pairedWebRuntime.includes('timeoutMs: 15_000')
        ? 15_000
        : Number.NaN

    expect(TERMINAL_TAB_PROVIDER_TEARDOWN_TIMEOUT_MS).toBeLessThan(
      TERMINAL_TAB_PROVIDER_RPC_TIMEOUT_MS
    )
    expect(TERMINAL_TAB_PROVIDER_RPC_TIMEOUT_MS).toBeLessThan(
      TERMINAL_TAB_CLOSE_RESPONSE_TIMEOUT_MS
    )
    expect(TERMINAL_TAB_CLOSE_RESPONSE_TIMEOUT_MS).toBeLessThan(pairedWebCallerTimeoutMs)
    expect(pairedWebCallerTimeoutMs).toBe(15_000)
    expect(directMobileRpc).toContain('const REQUEST_TIMEOUT_MS = 30_000')
    expect(relayMobileRpc).toContain('args.requestTimeoutMs ?? 30_000')
    expect(shortRpcSocket).toContain('const RUNTIME_RPC_SOCKET_IDLE_TIMEOUT_MS = 30_000')
    expect(TERMINAL_TAB_CLOSE_RESPONSE_TIMEOUT_MS).toBeLessThan(30_000)
  })
})
