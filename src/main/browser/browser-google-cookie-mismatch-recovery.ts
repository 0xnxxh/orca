// Why: accounts.google.com/CookieMismatch is a dead end that tells the user to clear
// cookies by hand — unreachable advice inside an embedded browser. Orca offers the fix
// instead: on the user's click it clears the partition's google.com-family cookies (the
// only ones Google's mismatch check reads) and reloads sign-in, so every other site's
// session survives. Nothing is ever cleared without that click.

import type { Cookie, Cookies } from 'electron'
import { normalizeCookieDomain } from './browser-cookie-import-policy'

const COOKIE_MISMATCH_HOST = 'accounts.google.com'
const RECOVERY_FALLBACK_URL = 'https://accounts.google.com/'

export function isGoogleCookieMismatchUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.toLowerCase() === COOKIE_MISMATCH_HOST &&
      /^\/cookiemismatch(?:\/|$)/i.test(url.pathname)
    )
  } catch {
    return false
  }
}

function isGoogleCookieDomain(normalizedDomain: string): boolean {
  return normalizedDomain === 'google.com' || normalizedDomain.endsWith('.google.com')
}

// Why: honor the flow's own continue target only when it stays on Google over https —
// auto-navigating wherever a query param points would hand redirect control to the page.
export function googleCookieMismatchRecoveryUrl(mismatchUrl: string): string {
  try {
    const continueParam = new URL(mismatchUrl).searchParams.get('continue')
    if (continueParam) {
      const target = new URL(continueParam)
      if (target.protocol === 'https:' && isGoogleCookieDomain(target.hostname.toLowerCase())) {
        return target.toString()
      }
    }
  } catch {
    // fall through to the plain sign-in page
  }
  return RECOVERY_FALLBACK_URL
}

function cookieRemovalUrl(cookie: Cookie, normalizedDomain: string): string {
  const url = new URL(`${cookie.secure ? 'https' : 'http'}://${normalizedDomain}/`)
  url.pathname = cookie.path?.startsWith('/') ? cookie.path : '/'
  return url.toString()
}

// Why: per-cookie best effort — one undeletable cookie must not strand the rest, and a
// partial clear still usually resolves the mismatch.
export async function clearGoogleCookies(
  store: Pick<Cookies, 'get' | 'remove'>
): Promise<{ removed: number; failed: number }> {
  const cookies = await store.get({})
  let removed = 0
  let failed = 0
  for (const cookie of cookies) {
    const domain = cookie.domain ? normalizeCookieDomain(cookie.domain) : null
    if (!domain || !isGoogleCookieDomain(domain)) {
      continue
    }
    try {
      await store.remove(cookieRemovalUrl(cookie, domain), cookie.name)
      removed++
    } catch {
      failed++
    }
  }
  return { removed, failed }
}

const PROMPT_COOLDOWN_MS = 2 * 60_000

// Why: a mismatch that recurs (or lands in several tabs at once) must not stack toasts.
// Keyed by session so one prompt covers the whole partition; WeakMap lets dead sessions GC.
export class GoogleCookieMismatchPromptThrottle {
  private readonly lastPromptBySession = new WeakMap<object, number>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  // Why: check-and-mark in one step so two mismatch navs racing in the same partition
  // cannot both prompt.
  shouldPrompt(session: object): boolean {
    const last = this.lastPromptBySession.get(session)
    if (last !== undefined && this.now() - last < PROMPT_COOLDOWN_MS) {
      return false
    }
    this.lastPromptBySession.set(session, this.now())
    return true
  }

  reset(session: object): void {
    this.lastPromptBySession.delete(session)
  }
}
