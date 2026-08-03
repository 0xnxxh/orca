import { reloadAppAsync } from 'expo'
import { useLocales } from 'expo-localization'
import { useEffect, useRef, useState } from 'react'
import {
  mobileI18n,
  selectPreferredMobileUiLocale,
  shouldReloadForMobileLocaleChange,
  type MobileUiLocale
} from './mobile-i18n'

const LOCALE_RELOAD_RETRY_MS = 1_000
const LOCALE_RELOAD_MAX_ATTEMPTS = 3

export function useMobileLocaleReload(): void {
  const locales = useLocales()
  const reloadRequestedRef = useRef(false)
  const reloadAttemptsRef = useRef(0)
  const reloadTargetRef = useRef<MobileUiLocale | null>(null)
  const mountedRef = useRef(true)
  const [retryPending, setRetryPending] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!retryPending) {
      return
    }
    const retryTimer = setTimeout(() => {
      setRetryPending(false)
      setRetryVersion((current) => current + 1)
    }, LOCALE_RELOAD_RETRY_MS)
    return () => clearTimeout(retryTimer)
  }, [retryPending])

  useEffect(() => {
    const languageTags = locales.map((locale) => locale.languageTag)
    const reloadTarget = selectPreferredMobileUiLocale(languageTags)
    if (!shouldReloadForMobileLocaleChange(mobileI18n.language as MobileUiLocale, languageTags)) {
      reloadAttemptsRef.current = 0
      reloadTargetRef.current = null
      return
    }
    if (reloadTargetRef.current !== reloadTarget) {
      reloadAttemptsRef.current = 0
      reloadTargetRef.current = reloadTarget
    }
    if (reloadRequestedRef.current || reloadAttemptsRef.current >= LOCALE_RELOAD_MAX_ATTEMPTS) {
      return
    }
    reloadRequestedRef.current = true
    reloadAttemptsRef.current += 1
    void reloadAppAsync('Mobile locale changed').catch(() => {
      reloadRequestedRef.current = false
      if (!mountedRef.current || reloadAttemptsRef.current >= LOCALE_RELOAD_MAX_ATTEMPTS) {
        return
      }
      setRetryPending(true)
    })
  }, [locales, retryVersion])
}
