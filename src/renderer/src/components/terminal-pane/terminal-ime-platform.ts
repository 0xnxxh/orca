export type TerminalImePlatform = {
  isMac: boolean
  /** Chromium on a Linux kernel — ChromeOS and Android included. */
  isLinux: boolean
  /** Desktop Linux only — the platforms actually running ibus or fcitx. */
  isDesktopLinux: boolean
}

// ChromeOS reports `X11; CrOS x86_64`, with no "Linux" anywhere in it, so a plain
// substring test puts it on the Windows side of every policy below.
const LINUX_KERNEL_PLATFORM = /Linux|CrOS/
const NON_DESKTOP_LINUX_PLATFORM = /Android|CrOS/

/**
 * Splits the two platform questions the terminal's IME policy asks, which are not the
 * same question and had been sharing one answer.
 *
 * Standalone keydown 229 is Chromium-family behavior, so ChromeOS and Android belong
 * with desktop Linux. The candidate-key guards read ibus/fcitx specifics that neither
 * shares, so they are scoped tighter. Deriving both here keeps one user agent from
 * getting two different platform verdicts in two different files.
 */
export function resolveTerminalImePlatform(userAgent: string): TerminalImePlatform {
  const isMac = userAgent.includes('Mac')
  const isLinux = !isMac && LINUX_KERNEL_PLATFORM.test(userAgent)
  return {
    isMac,
    isLinux,
    isDesktopLinux: isLinux && !NON_DESKTOP_LINUX_PLATFORM.test(userAgent)
  }
}
