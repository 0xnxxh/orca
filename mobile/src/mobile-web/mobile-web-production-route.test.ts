import { describe, expect, it } from 'vitest'
import { isRetiredNativeWorkspaceRoute } from './mobile-web-production-route'

describe('mobile web production route', () => {
  it.each(['/h', '/h/paired-host', '/h/paired-host/session/workspace'])(
    'retires the native workspace route %s',
    (pathname) => {
      expect(isRetiredNativeWorkspaceRoute(pathname)).toBe(true)
    }
  )

  it.each(['/', '/hybrid', '/settings', '/history'])('preserves shell route %s', (pathname) => {
    expect(isRetiredNativeWorkspaceRoute(pathname)).toBe(false)
  })
})
