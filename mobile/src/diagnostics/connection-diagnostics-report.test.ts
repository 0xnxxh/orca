import { describe, expect, it } from 'vitest'
import { buildConnectionDiagnosticsReport } from './connection-diagnostics-report'

const NOW = Date.UTC(2026, 6, 9, 22, 0, 0)

describe('buildConnectionDiagnosticsReport', () => {
  it('summarizes a failing Tailscale host with its log', () => {
    const report = buildConnectionDiagnosticsReport({
      endpoint: 'ws://100.65.9.106:6768',
      state: 'reconnecting',
      reconnectAttempts: 12,
      lastConnectedAt: NOW - 5 * 60_000,
      platform: 'ios 26.5.1',
      appVersion: '0.0.29',
      entries: [
        {
          id: 'log-1',
          ts: NOW - 60_000,
          level: 'error',
          message: 'WebSocket connect timeout',
          detail: 'wss://100.65.9.106:6768 token=secret /private/repo/file.ts'
        }
      ],
      nowMs: NOW
    })

    expect(report).toContain('App: Orca Mobile 0.0.29 · ios 26.5.1')
    expect(report).toContain('Connection path: Tailscale')
    expect(report).not.toContain('100.65.9.106')
    expect(report).toContain('State: reconnecting (reconnect attempts: 12)')
    expect(report).toContain('(5m 0s ago)')
    expect(report).toContain('[error] WebSocket connect timeout')
    expect(report).not.toContain('token=secret')
    expect(report).not.toContain('/private/repo')
  })

  it('marks never-connected sessions and empty logs', () => {
    const report = buildConnectionDiagnosticsReport({
      endpoint: 'ws://192.168.1.50:6768',
      state: 'connecting',
      reconnectAttempts: 0,
      lastConnectedAt: null,
      platform: 'android 15',
      appVersion: '0.0.29',
      entries: [],
      nowMs: NOW
    })

    expect(report).toContain('Connection path: Standard')
    expect(report).not.toContain('192.168.1.50')
    expect(report).toContain('Last connected: never this session')
    expect(report).toContain('No connection events recorded this session.')
  })

  it('includes bounded hosted package state without native session or cache identity', () => {
    const report = buildConnectionDiagnosticsReport({
      endpoint: 'ws://192.168.1.51:6768',
      state: 'connected',
      reconnectAttempts: 0,
      lastConnectedAt: NOW,
      platform: 'android 16',
      appVersion: '0.0.29',
      entries: [],
      mobileWeb: {
        bridgeVersion: 1,
        buildId: 'a'.repeat(64),
        packageSource: 'verified-cache',
        packageStatus: 'warning',
        activationMs: 148,
        refreshMs: 973,
        healthStatus: 'recovered',
        recoveryCount: 2,
        terminalResyncCount: 3,
        terminalOverflowCount: 1,
        terminalAckLagMaxMs: 47,
        terminalOutstandingBytesHighWater: 65_536,
        terminalLastResyncReason: 'flow-overflow',
        lastFailureCode: 'webview_crash_loop'
      },
      nowMs: NOW
    })

    expect(report).toContain('Hosted workspace interface')
    expect(report).toContain('Package: warning (verified-cache)')
    expect(report).toContain('Build: aaaaaaaaaaaa')
    expect(report).not.toContain('a'.repeat(64))
    expect(report).toContain('Health: recovered')
    expect(report).toContain('Activation: 148 ms')
    expect(report).toContain('Refresh: 973 ms')
    expect(report).toContain('Recoveries: 2')
    expect(report).toContain('Terminal resyncs: 3 (last: flow-overflow)')
    expect(report).toContain('Terminal flow overflows: 1')
    expect(report).toContain('Terminal max ACK lag: 47 ms')
    expect(report).toContain('Terminal outstanding high water: 65536 bytes')
    expect(report).toContain('Last failure: webview_crash_loop')
    expect(report).not.toContain('sessionId')
    expect(report).not.toContain('/private/')
  })
})
