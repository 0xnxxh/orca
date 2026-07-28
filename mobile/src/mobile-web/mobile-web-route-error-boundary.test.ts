import { describe, expect, it } from 'vitest'

import { mobileWebRouteFailureCode } from './mobile-web-route-failure-code'

describe('mobile web route failure classification', () => {
  it.each([
    [new Error('Maximum update depth exceeded'), 'react-update-loop'],
    [new Error('Minified React error #185'), 'react-update-loop'],
    [new Error('ResizeObserver loop completed with undelivered notifications'), 'resize-observer'],
    [new Error('xterm cannot open this terminal'), 'terminal-render'],
    [new TypeError('Cannot read properties of undefined'), 'type-error'],
    [new Error('unexpected'), 'render-error']
  ])('classifies %s as %s', (error, code) => {
    expect(mobileWebRouteFailureCode(error)).toBe(code)
  })
})
