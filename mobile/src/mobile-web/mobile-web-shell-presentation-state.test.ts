import { describe, expect, it } from 'vitest'
import {
  mobileWebHostPickerPresentationState,
  mobileWebShellPresentationState,
  mobileWebShellShowsNativeChrome
} from './mobile-web-shell-presentation-state'

describe('mobile web shell presentation state', () => {
  it.each([
    [{ hasSelectedHost: false, hasSession: false, packageLoading: false }, 'host-picker'],
    [{ hasSelectedHost: false, hasSession: true, packageLoading: true }, 'host-picker'],
    [{ hasSelectedHost: true, hasSession: true, packageLoading: false }, 'hosted-interface'],
    [{ hasSelectedHost: true, hasSession: true, packageLoading: true }, 'hosted-interface'],
    [{ hasSelectedHost: true, hasSession: false, packageLoading: true }, 'package-loading'],
    [{ hasSelectedHost: true, hasSession: false, packageLoading: false }, 'package-unavailable']
  ] as const)('resolves shell inputs to %s', (inputs, expected) => {
    expect(mobileWebShellPresentationState(inputs)).toBe(expected)
  })

  it('removes prototype shell chrome around the unchanged hosted interface', () => {
    expect(mobileWebShellShowsNativeChrome('hosted-interface')).toBe(false)
    for (const state of ['host-picker', 'package-loading', 'package-unavailable'] as const) {
      expect(mobileWebShellShowsNativeChrome(state)).toBe(true)
    }
  })

  it.each([
    [{ loading: true, failed: true, hostCount: 1 }, 'loading'],
    [{ loading: false, failed: true, hostCount: 1 }, 'failed'],
    [{ loading: false, failed: false, hostCount: 0 }, 'empty'],
    [{ loading: false, failed: false, hostCount: 1 }, 'ready']
  ] as const)('resolves host-picker inputs to %s', (inputs, expected) => {
    expect(mobileWebHostPickerPresentationState(inputs)).toBe(expected)
  })
})
