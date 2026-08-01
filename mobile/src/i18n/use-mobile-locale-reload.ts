import { reloadAppAsync } from 'expo'
import { useLocales } from 'expo-localization'
import { useEffect, useRef, useState } from 'react'
import { mobileI18n, shouldReloadForMobileLocaleChange, type MobileUiLocale } from './mobile-i18n'

const LOCALE_RELOAD_RETRY_MS = 1_000

export function useMobileLocaleReload(): void {
  const locales = useLocales()
  const reloadRequestedRef = useRef(false)
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
    if (
      reloadRequestedRef.current ||
      !shouldReloadForMobileLocaleChange(
        mobileI18n.language as MobileUiLocale,
        locales.map((locale) => locale.languageTag)
      )
    ) {
      return
    }
    reloadRequestedRef.current = true
    void reloadAppAsync('Mobile locale changed').catch(() => {
      reloadRequestedRef.current = false
      if (!mountedRef.current) {
        return
      }
      setRetryPending(true)
    })
  }, [locales, retryVersion])
}
