import { describe, expect, it } from 'vitest'
import { encodeTerminalTuiCopyInput } from './terminal-tui-copy-input'

describe('encodeTerminalTuiCopyInput', () => {
  it('does not send copy to a shell without negotiated Kitty keyboard input', () => {
    expect(encodeTerminalTuiCopyInput('darwin', 0)).toBeNull()
  })

  it('encodes the macOS copy chord for a TUI-owned selection', () => {
    expect(encodeTerminalTuiCopyInput('darwin', 1)).toBe('\x1b[99;9u')
  })

  it('encodes the Linux and Windows terminal copy chord', () => {
    expect(encodeTerminalTuiCopyInput('linux', 1)).toBe('\x1b[99;6u')
    expect(encodeTerminalTuiCopyInput('win32', 1)).toBe('\x1b[99;6u')
  })
})
