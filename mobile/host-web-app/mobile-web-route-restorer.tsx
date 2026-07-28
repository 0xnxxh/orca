import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'

import { useMobileWebNativeShell } from '../../src/mobile-web/src/native-shell-channel'
import { mobileWebNavigationRouteTarget } from '../src/mobile-web/mobile-web-route-restoration'

const HOSTED_PAGE_HOST_ID = 'paired-orca-desktop'

export function MobileWebRouteRestorer() {
  const router = useRouter()
  const shell = useMobileWebNativeShell()
  const restoredContextRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!shell.context) {
      return
    }
    const restorationKey = `${shell.context.shellSessionId}:${shell.context.buildId}:${shell.routeRevision}`
    if (restoredContextRef.current === restorationKey) {
      return
    }
    restoredContextRef.current = restorationKey
    router.replace(mobileWebNavigationRouteTarget(shell.navigationRoute, HOSTED_PAGE_HOST_ID))
  }, [router, shell.context, shell.navigationRoute, shell.routeRevision])

  return null
}
