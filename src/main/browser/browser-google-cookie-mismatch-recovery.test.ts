import { describe, expect, it, vi } from 'vitest'
import type { Cookie } from 'electron'
import {
  GoogleCookieMismatchPromptThrottle,
  clearGoogleCookies,
  googleCookieMismatchRecoveryUrl,
  isGoogleCookieMismatchUrl
} from './browser-google-cookie-mismatch-recovery'

function cookie(domain: string, name: string, path = '/', secure = true): Cookie {
  return {
    domain,
    name,
    path,
    secure,
    sameSite: 'unspecified',
    value: 'secret'
  }
}

describe('isGoogleCookieMismatchUrl', () => {
  it('matches the CookieMismatch page on accounts.google.com only', () => {
    expect(isGoogleCookieMismatchUrl('https://accounts.google.com/CookieMismatch')).toBe(true)
    expect(
      isGoogleCookieMismatchUrl(
        'https://accounts.google.com/CookieMismatch?continue=https%3A%2F%2Fmail.google.com%2F'
      )
    ).toBe(true)
    expect(isGoogleCookieMismatchUrl('https://accounts.google.com/CookieMismatch/')).toBe(true)
    expect(isGoogleCookieMismatchUrl('https://Accounts.Google.Com/cookiemismatch')).toBe(true)
  })

  it('rejects other paths, hosts, and schemes', () => {
    expect(isGoogleCookieMismatchUrl('https://accounts.google.com/signin')).toBe(false)
    expect(isGoogleCookieMismatchUrl('https://accounts.google.com/CookieMismatchFoo')).toBe(false)
    expect(
      isGoogleCookieMismatchUrl('https://accounts.google.com.evil.example/CookieMismatch')
    ).toBe(false)
    expect(isGoogleCookieMismatchUrl('https://google.com/CookieMismatch')).toBe(false)
    expect(isGoogleCookieMismatchUrl('file:///CookieMismatch')).toBe(false)
    expect(isGoogleCookieMismatchUrl('not a url')).toBe(false)
  })
})

describe('googleCookieMismatchRecoveryUrl', () => {
  it('recovers the continue target when it is a Google https URL', () => {
    expect(
      googleCookieMismatchRecoveryUrl(
        'https://accounts.google.com/CookieMismatch?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F'
      )
    ).toBe('https://mail.google.com/mail/')
  })

  it('falls back to the sign-in page for missing, non-Google, or insecure continue targets', () => {
    expect(googleCookieMismatchRecoveryUrl('https://accounts.google.com/CookieMismatch')).toBe(
      'https://accounts.google.com/'
    )
    expect(
      googleCookieMismatchRecoveryUrl(
        'https://accounts.google.com/CookieMismatch?continue=https%3A%2F%2Fevil.example%2F'
      )
    ).toBe('https://accounts.google.com/')
    expect(
      googleCookieMismatchRecoveryUrl(
        'https://accounts.google.com/CookieMismatch?continue=http%3A%2F%2Fmail.google.com%2F'
      )
    ).toBe('https://accounts.google.com/')
    expect(
      googleCookieMismatchRecoveryUrl('https://accounts.google.com/CookieMismatch?continue=%25')
    ).toBe('https://accounts.google.com/')
  })
})

describe('clearGoogleCookies', () => {
  it('removes google.com-family cookies and retains every other domain', async () => {
    const get = vi
      .fn()
      .mockResolvedValue([
        cookie('.google.com', 'SID'),
        cookie('accounts.google.com', 'ACCOUNT_CHOOSER', '/signin'),
        cookie('.accounts.google.com', 'LSID', '/', false),
        cookie('.google.com.evil.example', 'suffix-confusion'),
        cookie('.github.com', 'user_session'),
        cookie('.example.com', 'unrelated')
      ])
    const remove = vi.fn().mockResolvedValue(undefined)

    const result = await clearGoogleCookies({ get, remove })

    expect(result).toEqual({ removed: 3, failed: 0 })
    expect(remove.mock.calls).toEqual([
      ['https://google.com/', 'SID'],
      ['https://accounts.google.com/signin', 'ACCOUNT_CHOOSER'],
      ['http://accounts.google.com/', 'LSID']
    ])
  })

  it('keeps clearing after a single cookie fails to remove', async () => {
    const get = vi
      .fn()
      .mockResolvedValue([cookie('.google.com', 'SID'), cookie('.google.com', 'HSID')])
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined)

    const result = await clearGoogleCookies({ get, remove })

    expect(result).toEqual({ removed: 1, failed: 1 })
    expect(remove).toHaveBeenCalledTimes(2)
  })
})

describe('GoogleCookieMismatchPromptThrottle', () => {
  it('prompts once per partition per cooldown window', () => {
    let clock = 0
    const throttle = new GoogleCookieMismatchPromptThrottle(() => clock)
    const session = {}

    expect(throttle.shouldPrompt(session)).toBe(true)
    expect(throttle.shouldPrompt(session)).toBe(false)
    clock += 30_000
    expect(throttle.shouldPrompt(session)).toBe(false)
    clock += 2 * 60_000
    expect(throttle.shouldPrompt(session)).toBe(true)
  })

  it('allows a new prompt after the prior recovery is no longer actionable', () => {
    const throttle = new GoogleCookieMismatchPromptThrottle(() => 0)
    const session = {}

    expect(throttle.shouldPrompt(session)).toBe(true)
    throttle.reset(session)
    expect(throttle.shouldPrompt(session)).toBe(true)
  })

  it('tracks partitions independently', () => {
    const throttle = new GoogleCookieMismatchPromptThrottle(() => 0)
    const sessionA = {}
    const sessionB = {}

    expect(throttle.shouldPrompt(sessionA)).toBe(true)
    expect(throttle.shouldPrompt(sessionB)).toBe(true)
    expect(throttle.shouldPrompt(sessionA)).toBe(false)
  })
})
