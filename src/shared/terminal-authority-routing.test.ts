import { describe, expect, it } from 'vitest'
import {
  isTerminalAuthorityEventMethod,
  TERMINAL_AUTHORITY_NOTIFICATION_METHODS,
  TERMINAL_AUTHORITY_REQUEST_METHODS
} from './terminal-authority-routing'

describe('terminal authority routing', () => {
  it('routes PTY ownership and terminal hook requests to the authority', () => {
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.spawn')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.shutdownExact')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.shutdownAuthorityExact')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.sendSignalExact')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.sendSignalAuthorityExact')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.clearBufferExact')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('pty.clearBufferAuthorityExact')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('agent_hook.installPlugins')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain(
      'terminalAuthority.resolveConsumerNamespace'
    )
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain(
      'terminalAuthority.acceptNamespaceOutcomeBoundary'
    )
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).toContain('terminalAuthority.ackNamespaceOutcome')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).not.toContain('git.status')
    expect(TERMINAL_AUTHORITY_REQUEST_METHODS).not.toContain('orca.cli')
  })

  it('routes exact PTY mutations but not control-plane notifications', () => {
    expect(TERMINAL_AUTHORITY_NOTIFICATION_METHODS).toContain('pty.dataExact')
    expect(TERMINAL_AUTHORITY_NOTIFICATION_METHODS).toContain('pty.dataAuthorityExact')
    expect(TERMINAL_AUTHORITY_NOTIFICATION_METHODS).toContain('pty.resizeExact')
    expect(TERMINAL_AUTHORITY_NOTIFICATION_METHODS).toContain('pty.resizeAuthorityExact')
    expect(TERMINAL_AUTHORITY_NOTIFICATION_METHODS).not.toContain('fs.unwatch')
    expect(TERMINAL_AUTHORITY_NOTIFICATION_METHODS).not.toContain('relay.configureGraceTime')
  })

  it('admits only authority-originated terminal events', () => {
    expect(isTerminalAuthorityEventMethod('pty.data')).toBe(true)
    expect(isTerminalAuthorityEventMethod('pty.recoveryComplete')).toBe(true)
    expect(isTerminalAuthorityEventMethod('agent.hook')).toBe(true)
    expect(isTerminalAuthorityEventMethod('fs.changed')).toBe(false)
  })
})
