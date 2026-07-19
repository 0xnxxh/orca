import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { translate } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { cn } from '@/lib/utils'
import type { MobileRelayStatus } from '../../../../shared/mobile-relay-status'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

function relayStatusLabel(status: MobileRelayStatus): string {
  if (status === 'registered') {
    return translate('auto.components.settings.MobilePairingConnectionOptions.ready', 'Ready')
  }
  if (status === 'connecting') {
    return translate(
      'auto.components.settings.MobilePairingConnectionOptions.connecting',
      'Connecting'
    )
  }
  if (status === 'standby') {
    return translate(
      'auto.components.settings.MobilePairingConnectionOptions.available',
      'Available'
    )
  }
  if (status === 'draining') {
    return translate(
      'auto.components.settings.MobilePairingConnectionOptions.reconnecting',
      'Reconnecting'
    )
  }
  return translate(
    'auto.components.settings.MobilePairingConnectionOptions.unavailable',
    'Unavailable'
  )
}

type PathOptionProps = {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
  trailing?: ReactNode
}

function PathOption({
  selected,
  onSelect,
  title,
  description,
  trailing
}: PathOptionProps): React.JSX.Element {
  return (
    <div
      role="radio"
      tabIndex={0}
      aria-checked={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'flex cursor-pointer items-start gap-3 px-3 py-2.5 outline-none transition-colors',
        'focus-visible:bg-accent/50',
        selected ? 'bg-accent/40' : 'hover:bg-accent/20'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-foreground bg-foreground' : 'border-muted-foreground/40'
        )}
        aria-hidden
      >
        {selected ? <span className="size-1.5 rounded-full bg-background" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium leading-none">{title}</span>
          {trailing}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function MobilePairingConnectionOptions({
  value,
  onChange,
  compact = false
}: {
  value: MobilePairingConnectionMode
  onChange: (value: MobilePairingConnectionMode) => void
  compact?: boolean
}): React.JSX.Element {
  const authStatus = useAppStore((state) => state.orcaProfileAuthStatus)
  const connecting = useAppStore((state) => state.orcaProfileConnecting)
  const connect = useAppStore((state) => state.connectCurrentOrcaProfile)
  const fetchAuthStatus = useAppStore((state) => state.fetchOrcaProfileAuthStatus)
  const [relayStatus, setRelayStatus] = useState<MobileRelayStatus>('offline')
  const signedIn = authStatus?.state === 'connected'
  const reconnectRequired = authStatus?.state === 'reconnect-required'
  const needsSignIn = value === 'automatic' && !signedIn

  useEffect(() => {
    if (!authStatus) {
      void fetchAuthStatus()
    }
  }, [authStatus, fetchAuthStatus])

  useEffect(() => {
    let receivedEvent = false
    let active = true
    const unsubscribe = window.api.mobile.onRelayStatusChanged((status) => {
      receivedEvent = true
      if (active) {
        setRelayStatus(status)
      }
    })
    void window.api.mobile
      .getRelayStatus()
      .then(({ status }) => {
        if (active && !receivedEvent) {
          setRelayStatus(status)
        }
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <div className={cn('space-y-2', compact && 'space-y-1.5')}>
      <div
        role="radiogroup"
        aria-label={translate(
          'auto.components.settings.MobilePairingConnectionOptions.pathGroup',
          'How the phone reaches this computer'
        )}
        className="overflow-hidden rounded-md border border-border"
      >
        <PathOption
          selected={value === 'automatic'}
          onSelect={() => onChange('automatic')}
          title={translate(
            'auto.components.settings.MobilePairingConnectionOptions.anywhereTitle',
            'Orca Relay'
          )}
          description={translate(
            'auto.components.settings.MobilePairingConnectionOptions.anywhereDescription',
            'Phone can be on cellular or any Wi‑Fi. Sign-in required.'
          )}
          trailing={
            signedIn && value === 'automatic' ? (
              <Badge variant="outline" className="text-[10px]">
                {relayStatusLabel(relayStatus)}
              </Badge>
            ) : null
          }
        />
        <div className="border-t border-border" />
        <PathOption
          selected={value === 'local-only'}
          onSelect={() => onChange('local-only')}
          title={translate(
            'auto.components.settings.MobilePairingConnectionOptions.localTitle',
            'Local network'
          )}
          description={translate(
            'auto.components.settings.MobilePairingConnectionOptions.localDescription',
            'Phone must be on this Wi‑Fi or your Tailscale. No sign-in.'
          )}
        />
      </div>

      {needsSignIn ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
          data-testid="anywhere-sign-in-panel"
        >
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.MobilePairingConnectionOptions.signInRequired',
              'Sign in to use Orca Mobile Relay.'
            )}
          </p>
          <Button
            type="button"
            size="sm"
            disabled={connecting}
            onClick={() => {
              onChange('automatic')
              void connect()
            }}
          >
            {connecting ? <Loader2 className="animate-spin" /> : null}
            {reconnectRequired
              ? translate(
                  'auto.components.settings.MobilePairingConnectionOptions.signInAgain',
                  'Sign in again'
                )
              : translate(
                  'auto.components.settings.MobilePairingConnectionOptions.signIn',
                  'Sign in'
                )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
