import { describe, expect, it, vi } from 'vitest'
import { installMobileWebHistorySessionFragment } from './mobile-web-history-session-fragment'

describe('mobile web history session fragment', () => {
  it('keeps the opaque session on same-origin path and query writes', () => {
    const target = historyTarget()

    expect(installMobileWebHistorySessionFragment(target)).toBe(true)
    target.history.pushState({ page: 1 }, '', '/h/host/session/workspace?name=repo')
    target.history.replaceState({ page: 2 }, '', '/h/host/tasks#other')

    expect(target.pushState).toHaveBeenCalledWith(
      { page: 1 },
      '',
      `https://orca-mobile-web.invalid/h/host/session/workspace?name=repo#${SESSION_ID}`
    )
    expect(target.replaceState).toHaveBeenCalledWith(
      { page: 2 },
      '',
      `https://orca-mobile-web.invalid/h/host/tasks#${SESSION_ID}`
    )
  })

  it('leaves cross-origin and invalid URLs to browser enforcement', () => {
    const target = historyTarget()
    installMobileWebHistorySessionFragment(target)

    target.history.pushState(null, '', 'https://example.test/path')
    target.history.replaceState(null, '', 'http://[')

    expect(target.pushState).toHaveBeenCalledWith(null, '', 'https://example.test/path')
    expect(target.replaceState).toHaveBeenCalledWith(null, '', 'http://[')
  })

  it('does not wrap missing, malformed, or already wrapped session history', () => {
    const target = historyTarget()

    expect(
      installMobileWebHistorySessionFragment({
        ...target,
        location: { ...target.location, hash: '#short' }
      })
    ).toBe(false)
    expect(installMobileWebHistorySessionFragment(target)).toBe(true)
    expect(installMobileWebHistorySessionFragment(target)).toBe(false)
  })
})

const SESSION_ID = 'S'.repeat(43)

function historyTarget() {
  const pushState = vi.fn()
  const replaceState = vi.fn()
  return {
    pushState,
    replaceState,
    history: { pushState, replaceState },
    location: {
      hash: `#${SESSION_ID}`,
      href: `https://orca-mobile-web.invalid/#${SESSION_ID}`,
      origin: 'https://orca-mobile-web.invalid'
    }
  }
}
