import { resolveShortcutPlatform } from '@/lib/shortcut-platform'

export type TerminalImePlatform = {
  isMac: boolean
  /** Everything that is neither macOS nor Windows, matching `getShortcutPlatform`. */
  isLinux: boolean
  /** Desktop Linux only — the platforms actually running ibus or fcitx. */
  isDesktopLinux: boolean
}

const NON_DESKTOP_LINUX_PLATFORM = /Android|CrOS/

/**
 * Splits the two platform questions the terminal's IME policy asks, which are not the
 * same question and had been sharing one answer.
 *
 * Standalone keydown 229 is really a question about Windows, whose preedit-diff race is
 * the only reason to suppress it, so every other platform passes. Sharing the renderer's
 * one user-agent mapping is what keeps that set from drifting: enumerating Linux-ish
 * user agents here instead is how ChromeOS — which reports `X11; CrOS x86_64`, with no
 * "Linux" in it — ended up on the Windows side of this policy while the rest of the
 * renderer treated it as Linux.
 *
 * The candidate-key guards read ibus/fcitx specifics that ChromeOS and Android do not
 * share, so they are scoped tighter. That narrowing is the only intended difference.
 */
export function resolveTerminalImePlatform(userAgent: string): TerminalImePlatform {
  const platform = resolveShortcutPlatform(userAgent)
  const isLinux = platform === 'linux'
  return {
    isMac: platform === 'darwin',
    isLinux,
    isDesktopLinux: isLinux && !NON_DESKTOP_LINUX_PLATFORM.test(userAgent)
  }
}
