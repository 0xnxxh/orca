import { describe, expect, it } from 'vitest'
import { resolveTerminalImePlatform } from './terminal-ime-platform'

const DESKTOP_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const CHROME_OS =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const MACOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('resolveTerminalImePlatform', () => {
  it('treats desktop Linux as both Chromium-family and ibus/fcitx-bearing', () => {
    expect(resolveTerminalImePlatform(DESKTOP_LINUX)).toEqual({
      isMac: false,
      isLinux: true,
      isDesktopLinux: true
    })
  })

  // The split exists for these two: their UA says Linux, so they share the 229 behavior,
  // but neither runs the input methods the candidate-key guards are written against.
  it.each([
    ['ChromeOS', CHROME_OS],
    ['Android', ANDROID]
  ])('keeps %s in the Chromium family but out of the desktop guards', (_name, userAgent) => {
    expect(resolveTerminalImePlatform(userAgent)).toEqual({
      isMac: false,
      isLinux: true,
      isDesktopLinux: false
    })
  })

  it.each([
    ['macOS', MACOS, true],
    ['Windows', WINDOWS, false]
  ])('reports %s as neither Linux flavour', (_name, userAgent, isMac) => {
    expect(resolveTerminalImePlatform(userAgent)).toEqual({
      isMac,
      isLinux: false,
      isDesktopLinux: false
    })
  })
})
