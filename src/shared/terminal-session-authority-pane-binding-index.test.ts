import { describe, expect, it } from 'vitest'
import type { TerminalSessionBinding } from './terminal-session-authority-identity'
import { TerminalAuthorityPaneBindingIndex } from './terminal-session-authority-pane-binding-index'

describe('TerminalAuthorityPaneBindingIndex', () => {
  it('retains owner reachability until its final pane binding retires', () => {
    const index = new TerminalAuthorityPaneBindingIndex()
    const first = binding('owner-a', 'pty-a', 'incarnation-a')
    const second = binding('owner-a', 'pty-b', 'incarnation-b')
    const replacement = binding('owner-b', 'pty-c', 'incarnation-c')

    index.replace(null, first, 'pane-a')
    index.replace(null, second, 'pane-b')
    expect(index.ownerHasBinding('owner-a')).toBe(true)
    expect(index.ptyOwner(first)).toBe('pane-a')
    expect(index.ptyOwner(second)).toBe('pane-b')

    index.replace(first, null, 'pane-a')
    expect(index.ownerHasBinding('owner-a')).toBe(true)
    expect(index.ptyOwner(first)).toBeNull()

    index.replace(second, replacement, 'pane-b')
    expect(index.ownerHasBinding('owner-a')).toBe(false)
    expect(index.ownerHasBinding('owner-b')).toBe(true)
    expect(index.ptyOwner(second)).toBeNull()
    expect(index.ptyOwner(replacement)).toBe('pane-b')
  })
})

function binding(
  ownerIncarnationId: string,
  physicalPtyId: string,
  ptyIncarnationId: string
): TerminalSessionBinding {
  return { ownerIncarnationId, physicalPtyId, ptyIncarnationId }
}
