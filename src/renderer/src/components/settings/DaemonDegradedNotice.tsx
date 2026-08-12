import { TriangleAlert } from 'lucide-react'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'

/**
 * Degraded mode used to be rare and transient, so a console warning was enough. It is now the
 * settled outcome for a daemon the launcher could not classify — it holds one rather than
 * killing terminals it might still be hosting — which makes it permanent until the user acts.
 * A permanent state nothing renders is one the user cannot act on.
 */
export function DaemonDegradedNotice(props: {
  degraded: boolean
  isBusy: boolean
  onRestartDaemon: () => void
}): React.JSX.Element | null {
  if (!props.degraded) {
    return null
  }

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-300"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {translate(
              'components.settings.DaemonDegradedNotice.title',
              'New terminals aren’t being saved'
            )}
          </p>
          <p className="text-sm opacity-90">
            {translate(
              'components.settings.DaemonDegradedNotice.body',
              'The terminal host stopped responding, so Orca kept it rather than ending anything it may still be running. Terminals already open keep working. New ones run outside it and will close when you quit Orca. Restarting the host fixes this — it also ends any session the host is still holding.'
            )}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={props.isBusy}
        onClick={props.onRestartDaemon}
      >
        {translate('components.settings.DaemonDegradedNotice.action', 'Restart host')}
      </Button>
    </div>
  )
}
