import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DaemonDegradedNotice } from './DaemonDegradedNotice'

function render(props: Partial<React.ComponentProps<typeof DaemonDegradedNotice>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(DaemonDegradedNotice, {
      degraded: true,
      isBusy: false,
      onRestartDaemon: vi.fn(),
      ...props
    })
  )
}

describe('DaemonDegradedNotice', () => {
  it('renders nothing when the daemon is healthy', () => {
    // The common case by far; a notice that shows up here would train the user to ignore it.
    expect(render({ degraded: false })).toBe('')
  })

  it('warns that new terminals will not survive quitting', () => {
    // The consequence the user actually needs, not the mechanism. Degraded mode's real cost is
    // that a terminal opened now disappears on quit, and nothing else in the app says so.
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toMatch(/aren’t being saved/)
    expect(html).toMatch(/close when you quit/)
  })

  it('says the remedy also ends whatever the host is still holding', () => {
    // Restarting is not free: it kills the sessions this whole change exists to protect. A
    // remedy offered without its cost is how a user loses agents by clicking the helpful button.
    expect(render()).toMatch(/ends any session the host is still holding/)
  })

  it('offers the restart action, disabled while another daemon action runs', () => {
    // Matched as an attribute, not a substring: the button's utility classes contain
    // `disabled:opacity-50`, so a contains-check passes whether or not it is really disabled.
    const disabledAttribute = /<button[^>]*\sdisabled[=>]/
    expect(render()).toContain('Restart host')
    expect(render({ isBusy: true })).toMatch(disabledAttribute)
    expect(render({ isBusy: false })).not.toMatch(disabledAttribute)
  })
})
