import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, HardDrive, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type {
  DeveloperPermissionId,
  DeveloperPermissionState,
  DeveloperPermissionStatus
} from '../../../../shared/developer-permissions-types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMountedRef } from '@/hooks/useMountedRef'
import { isMacUserAgent } from '../terminal-pane/pane-helpers'
import {
  isFullDiskAccessReady,
  isFullDiskAccessSetupVisible
} from '../feature-wall/FullDiskAccessSetupPrompt'
import { translate } from '@/i18n/i18n'

const FULL_DISK_ACCESS_PERMISSION_ID: DeveloperPermissionId = 'full-disk-access'
// Why: camelCase segment + .v1 suffix matches sibling one-time sidebar keys
// (orca.workspaceBoardMovedHintSeen.v1); bump the version to re-surface later.
const DISMISS_KEY = 'orca.fullDiskAccessNudgeDismissed.v1'

// Why: the FDA status probe reads Safari's TCC-protected data — the same "other
// apps' data" read this nudge exists to reduce — so it must run at most once per
// renderer session, shared across StrictMode replay and sidebar remounts (#9756).
let cachedFullDiskAccessStatus: DeveloperPermissionStatus | undefined
let fullDiskAccessProbed = false
let fullDiskAccessProbe: Promise<DeveloperPermissionStatus | undefined> | null = null

function getFullDiskAccessStatus(
  states: readonly DeveloperPermissionState[]
): DeveloperPermissionStatus | undefined {
  return states.find((state) => state.id === FULL_DISK_ACCESS_PERMISSION_ID)?.status
}

function rememberFullDiskAccessStatus(status: DeveloperPermissionStatus | undefined): void {
  cachedFullDiskAccessStatus = status
  fullDiskAccessProbed = true
}

function probeFullDiskAccessStatusOnce(): Promise<DeveloperPermissionStatus | undefined> {
  if (fullDiskAccessProbed) {
    return Promise.resolve(cachedFullDiskAccessStatus)
  }
  if (!fullDiskAccessProbe) {
    fullDiskAccessProbe = window.api.developerPermissions
      .getStatus()
      .then((states) => {
        rememberFullDiskAccessStatus(getFullDiskAccessStatus(states))
        return cachedFullDiskAccessStatus
      })
      .catch(() => {
        // Inconclusive probe: allow a later mount to retry rather than caching it.
        fullDiskAccessProbe = null
        return undefined
      })
  }
  return fullDiskAccessProbe
}

// Why: a fresh, cache-bypassing probe used only on CTA return-focus so the card
// can hide the moment a Full Disk Access grant takes effect for this process.
function refreshFullDiskAccessStatus(): Promise<DeveloperPermissionStatus | undefined> {
  return window.api.developerPermissions
    .getStatus()
    .then((states) => {
      const next = getFullDiskAccessStatus(states)
      rememberFullDiskAccessStatus(next)
      return next
    })
    .catch(() => cachedFullDiskAccessStatus)
}

export function resetFullDiskAccessProbeForTests(): void {
  cachedFullDiskAccessStatus = undefined
  fullDiskAccessProbed = false
  fullDiskAccessProbe = null
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function persistDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Best-effort; if storage is unavailable the nudge returns next launch.
  }
}

export function shouldShowFullDiskAccessNudge(args: {
  isMac: boolean
  dismissed: boolean
  status: DeveloperPermissionStatus | undefined
}): boolean {
  return (
    args.isMac &&
    !args.dismissed &&
    isFullDiskAccessSetupVisible(args.status) &&
    !isFullDiskAccessReady(args.status)
  )
}

/**
 * Ambient, dismissable sidebar card that surfaces the durable Full Disk Access
 * grant for the recurring macOS "access other apps' data" prompt (#9756) — a TCC
 * identity-churn artifact, not a code bug we can otherwise fix. Off macOS renders nothing.
 */
export function FullDiskAccessNudge(): React.JSX.Element | null {
  const mountedRef = useMountedRef()
  const isMac = isMacUserAgent()
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())
  const [status, setStatus] = useState<DeveloperPermissionStatus | undefined>(
    () => cachedFullDiskAccessStatus
  )
  const [requesting, setRequesting] = useState(false)
  const [watchForGrant, setWatchForGrant] = useState(false)

  useEffect(() => {
    // Why: probe only when the card could actually show — never off macOS or once
    // dismissed. probeFullDiskAccessStatusOnce() reads protected data at most once.
    if (!isMac || dismissed) {
      return
    }
    void probeFullDiskAccessStatusOnce().then((next) => {
      if (mountedRef.current) {
        setStatus(next)
      }
    })
  }, [isMac, dismissed, mountedRef])

  useEffect(() => {
    // Why: only after the user clicked "Open System Settings" (explicit intent to
    // grant), watch return-focus for the grant so the card hides once FDA is
    // effective — one gated read per focus. Stops once granted or dismissed so a
    // permanently dismissed card never keeps probing protected data.
    if (!watchForGrant || dismissed || isFullDiskAccessReady(status)) {
      return
    }
    const onFocus = (): void => {
      void refreshFullDiskAccessStatus().then((next) => {
        if (mountedRef.current) {
          setStatus(next)
        }
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [watchForGrant, dismissed, status, mountedRef])

  const handleDismiss = useCallback((): void => {
    persistDismissed()
    setDismissed(true)
  }, [])

  const handleOpenSystemSettings = useCallback(async (): Promise<void> => {
    setRequesting(true)
    try {
      const result = await window.api.developerPermissions.request({
        id: FULL_DISK_ACCESS_PERMISSION_ID
      })
      // Why: the request re-probes in main (authoritative); record it in the
      // session cache before the mount check so an unmount mid-request can't
      // strand a later remount on a stale status.
      rememberFullDiskAccessStatus(result.status)
      if (!mountedRef.current) {
        return
      }
      // Why: feed it back so a granted result hides the card, and watch return-
      // focus for the eventual grant since it opens Settings first.
      setStatus(result.status)
      setWatchForGrant(true)
      if (result.status === 'granted') {
        toast.success(
          translate(
            'auto.components.sidebar.FullDiskAccessNudge.granted',
            'Full Disk Access granted'
          )
        )
      } else if (result.openedSystemSettings) {
        toast.message(
          translate(
            'auto.components.sidebar.FullDiskAccessNudge.openedPrivacy',
            'Opened macOS Privacy & Security'
          )
        )
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.sidebar.FullDiskAccessNudge.requestError',
            'Could not open System Settings'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setRequesting(false)
      }
    }
  }, [mountedRef])

  // Why: hidden while the probe is unresolved (no first-paint flash) and once FDA
  // is already granted; off macOS or after a permanent dismissal it never shows.
  if (!shouldShowFullDiskAccessNudge({ isMac, dismissed, status })) {
    return null
  }

  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="worktree-sidebar-notice-card rounded-lg p-3 text-worktree-sidebar-accent-foreground">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm font-semibold leading-snug">
              {translate(
                'auto.components.sidebar.FullDiskAccessNudge.title',
                'Reduce macOS permission prompts'
              )}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
                aria-label={translate(
                  'auto.components.sidebar.FullDiskAccessNudge.dismissAriaLabel',
                  'Dismiss Full Disk Access suggestion'
                )}
                onClick={handleDismiss}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.sidebar.FullDiskAccessNudge.dismiss', 'Dismiss')}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          {translate(
            'auto.components.sidebar.FullDiskAccessNudge.body',
            'Grant Full Disk Access to reduce repeated macOS prompts when this copy of Orca reads protected app data. Terminal sessions may still prompt separately.'
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mt-2 w-full gap-1.5"
          disabled={requesting}
          onClick={() => void handleOpenSystemSettings()}
        >
          {requesting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ExternalLink className="size-3" />
          )}
          {requesting
            ? translate('auto.components.sidebar.FullDiskAccessNudge.opening', 'Opening…')
            : translate(
                'auto.components.sidebar.FullDiskAccessNudge.openSystemSettings',
                'Open System Settings'
              )}
        </Button>
      </div>
    </div>
  )
}
