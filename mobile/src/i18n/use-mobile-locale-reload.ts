import { reloadAppAsync } from 'expo'
import { useLocales } from 'expo-localization'
import { useEffect, useRef, useState } from 'react'
import { mobileI18n, shouldReloadForMobileLocaleChange, type MobileUiLocale } from './mobile-i18n'

const LOCALE_RELOAD_RETRY_MS = 1_000

export function useMobileLocaleReload(): void {
  const locales = useLocales()
  const reloadRequestedRef = useRef(false)
  const [retryVersion, setRetryVersion] = useState(0)

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
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    void reloadAppAsync('Mobile locale changed').catch(() => {
      if (!active) {
        return
      }
      reloadRequestedRef.current = false
      retryTimer = setTimeout(
        () => setRetryVersion((current) => current + 1),
        LOCALE_RELOAD_RETRY_MS
      )
    })
    return () => {
      active = false
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [locales, retryVersion])
}
