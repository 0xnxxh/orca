type MobileWebHistoryWriter = (data: unknown, unused: string, url?: string | URL | null) => void

type MobileWebHistoryTarget = {
  history: {
    pushState: MobileWebHistoryWriter
    replaceState: MobileWebHistoryWriter
  }
  location: {
    hash: string
    href: string
    origin: string
  }
}

const SHELL_SESSION_FRAGMENT_PATTERN = /^#[A-Za-z0-9_-]{43}$/
const installedHistories = new WeakSet<object>()

export function installMobileWebHistorySessionFragment(
  target: MobileWebHistoryTarget = window
): boolean {
  const { history, location } = target
  if (!SHELL_SESSION_FRAGMENT_PATTERN.test(location.hash) || installedHistories.has(history)) {
    return false
  }
  history.pushState = sessionBoundHistoryWriter(history, history.pushState, location)
  history.replaceState = sessionBoundHistoryWriter(history, history.replaceState, location)
  installedHistories.add(history)
  return true
}

function sessionBoundHistoryWriter(
  history: MobileWebHistoryTarget['history'],
  writer: MobileWebHistoryWriter,
  location: MobileWebHistoryTarget['location']
): MobileWebHistoryWriter {
  return (data, unused, url) => {
    writer.call(history, data, unused, sessionBoundHistoryUrl(url, location))
  }
}

function sessionBoundHistoryUrl(
  value: string | URL | null | undefined,
  location: MobileWebHistoryTarget['location']
): string | URL | null | undefined {
  if (value == null) {
    return value
  }
  try {
    const candidate = new URL(String(value), location.href)
    if (candidate.origin !== location.origin) {
      return value
    }
    candidate.hash = location.hash
    return candidate.href
  } catch {
    return value
  }
}
