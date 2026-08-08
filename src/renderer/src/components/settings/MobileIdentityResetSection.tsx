import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'

type IdentityResetStatus = Awaited<ReturnType<typeof window.api.mobile.getIdentityResetStatus>>

export function MobileIdentityResetSection(): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const mountedRef = useMountedRef()
  const [status, setStatus] = useState<IdentityResetStatus>({
    inProgress: false,
    record: null
  })
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.mobile.getIdentityResetStatus()
      if (mountedRef.current) {
        setStatus(next)
      }
    } catch {
      // The status is advisory; reset itself remains authoritative in the main process.
    }
  }, [mountedRef])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!status.inProgress) {
      return
    }
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh, status.inProgress])

  const reset = useCallback(async (): Promise<void> => {
    if (busy) {
      return
    }
    if (!status.inProgress) {
      const confirmed = await confirm({
        title: translate(
          'auto.components.settings.MobileIdentityResetSection.confirmTitle',
          'Reset access identity?'
        ),
        description: translate(
          'auto.components.settings.MobileIdentityResetSection.confirmDescription',
          'Existing mobile, runtime, and remote connections will be disconnected and must be paired again.'
        ),
        confirmLabel: translate(
          'auto.components.settings.MobileIdentityResetSection.confirmLabel',
          'Reset access identity'
        ),
        confirmVariant: 'destructive'
      })
      if (!confirmed) {
        return
      }
    }
    setBusy(true)
    try {
      await window.api.mobile.resetIdentity()
      await refresh()
      toast.success(
        translate(
          'auto.components.settings.MobileIdentityResetSection.completed',
          'Access identity reset. Pair devices again to restore access.'
        )
      )
    } catch (error) {
      await refresh()
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.settings.MobileIdentityResetSection.failed',
              'Access identity reset is still pending. Retry when the required hosts are available.'
            )
      )
    } finally {
      if (mountedRef.current) {
        setBusy(false)
      }
    }
  }, [busy, confirm, mountedRef, refresh, status.inProgress])

  const phase = status.record?.phase
  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.MobileIdentityResetSection.title',
        'Reset access identity'
      )}
      description={translate(
        'auto.components.settings.MobileIdentityResetSection.description',
        'Replace the identity used to authorize paired devices and remote connections.'
      )}
      keywords={['identity', 'reset', 'pairing', 'access']}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {status.inProgress
            ? translate(
                'auto.components.settings.MobileIdentityResetSection.pending',
                'Reset is waiting for every known host and Relay acknowledgement. Keep Orca open or retry after unavailable hosts return.'
              )
            : translate(
                'auto.components.settings.MobileIdentityResetSection.helper',
                'Use this when the current access identity should no longer be trusted. All devices must be paired again.'
              )}
        </p>
        {phase ? (
          <p className="font-mono text-[11px] text-muted-foreground">Phase: {phase}</p>
        ) : null}
        <Button
          type="button"
          variant={status.inProgress ? 'outline' : 'destructive'}
          size="sm"
          disabled={busy}
          onClick={() => void reset()}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {status.inProgress
            ? translate('auto.components.settings.MobileIdentityResetSection.retry', 'Retry reset')
            : translate(
                'auto.components.settings.MobileIdentityResetSection.action',
                'Reset access identity'
              )}
        </Button>
      </div>
    </SearchableSetting>
  )
}
