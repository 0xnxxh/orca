import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'

import { useMobileWebNativeShell } from '../../src/mobile-web/src/native-shell-channel'
import { mobileWebResumeRouteTarget } from '../src/mobile-web/mobile-web-route-restoration'

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
    const target = mobileWebResumeRouteTarget(shell.resumeRoute, HOSTED_PAGE_HOST_ID)
    router.replace(target ?? '/')
  }, [router, shell.context, shell.resumeRoute, shell.routeRevision])

  return null
}
