import { Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { DEFAULT_AI_VAULT_SESSION_LIMIT } from './ai-vault-session-limit'

/**
 * One-time banner for the forced history-depth reset, shown the first time the panel
 * mounts after the update and pinned until acknowledged.
 *
 * Why inline instead of a popover on the view-options button: this panel is ~350px
 * wide, so any floating card anchored inside it blankets the scope switch and search
 * field no matter which side it takes. A banner reflows the panel instead of covering it.
 */
export function AiVaultSessionLimitNotice({
  onAcknowledge
}: {
  onAcknowledge: () => void
}): React.JSX.Element {
  return (
    <div
      role="status"
      className="shrink-0 border-b border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-foreground"
          aria-hidden="true"
        >
          <Gauge className="size-3" />
        </span>
        <div className="min-w-0 text-xs font-semibold leading-snug text-foreground">
          {translate(
            'auto.components.right.sidebar.AiVaultSessionLimitNotice.title',
            'History depth is now {{value0}}',
            { value0: String(DEFAULT_AI_VAULT_SESSION_LIMIT) }
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.AiVaultSessionLimitNotice.body',
          'We lowered your Agent Session History depth for performance — deeper histories slow the whole app, especially on remote hosts. Change it any time under View options → History depth.'
        )}
      </p>
      <div className="mt-2 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={onAcknowledge}
        >
          {translate('auto.components.right.sidebar.AiVaultSessionLimitNotice.gotIt', 'Got it')}
        </Button>
      </div>
    </div>
  )
}
