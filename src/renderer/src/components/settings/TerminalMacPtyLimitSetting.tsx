import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MacosPtyLimitStatus } from '../../../../shared/macos-pty-limit'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { SettingsBadge, SettingsRow } from './SettingsFormControls'
import { getTerminalMacPtyLimitSearchEntries } from './terminal-advanced-platform-search'

export function TerminalMacPtyLimitSetting(): React.JSX.Element | null {
  const confirm = useConfirmationDialog()
  const mountedRef = useMountedRef()
  const [status, setStatus] = useState<MacosPtyLimitStatus | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const searchEntry = getTerminalMacPtyLimitSearchEntries()[0]

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const nextStatus = await window.api.macosPtyLimit.getStatus()
      if (mountedRef.current) {
        setStatus(nextStatus)
      }
    } catch (error) {
      console.error('[macos-pty-limit] failed to load status', error)
      if (mountedRef.current) {
        setStatus({ state: 'unavailable' })
      }
    }
  }, [mountedRef])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const increaseLimit = async (): Promise<void> => {
    if (isBusy) {
      return
    }
    setIsBusy(true)
    const confirmed = await confirm({
      title: translate(
        'auto.components.settings.TerminalMacPtyLimitSetting.confirmTitle',
        'Increase the system PTY limit?'
      ),
      description: translate(
        'auto.components.settings.TerminalMacPtyLimitSetting.confirmDescription',
        'macOS will request administrator authentication. This raises the limit for all apps on this Mac until restart, allowing runaway processes to consume more PTYs and related resources.'
      ),
      confirmLabel: translate(
        'auto.components.settings.TerminalMacPtyLimitSetting.confirmLabel',
        'Increase limit'
      )
    })
    if (!confirmed) {
      if (mountedRef.current) {
        setIsBusy(false)
      }
      return
    }

    try {
      const result = await window.api.macosPtyLimit.increase()
      if (!mountedRef.current) {
        return
      }
      if (result.outcome === 'increased' || result.outcome === 'already-maximum') {
        setStatus(result.status)
        if (result.outcome === 'increased') {
          toast.success(
            translate(
              'auto.components.settings.TerminalMacPtyLimitSetting.success',
              'System PTY limit increased to 999 until restart.'
            )
          )
        }
      } else if (result.outcome === 'failed') {
        toast.error(
          translate(
            'auto.components.settings.TerminalMacPtyLimitSetting.failure',
            'Couldn’t increase the system PTY limit.'
          )
        )
      } else if (result.outcome === 'unsupported') {
        setStatus({ state: 'unsupported' })
      }
    } catch (error) {
      console.error('[macos-pty-limit] failed to increase limit', error)
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.TerminalMacPtyLimitSetting.failure',
            'Couldn’t increase the system PTY limit.'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setIsBusy(false)
      }
    }
  }

  if (!status || status.state === 'unsupported') {
    return null
  }

  return (
    <SearchableSetting {...searchEntry} id="terminal-macos-pty-limit">
      <SettingsRow
        alignTop
        label={searchEntry.title}
        description={translate(
          'auto.components.settings.TerminalMacPtyLimitSetting.description',
          'System-wide capacity for local terminal sessions. Remote SSH hosts are unaffected.'
        )}
        control={
          status.state === 'unavailable' ? (
            <Button variant="outline" size="sm" onClick={() => void refreshStatus()}>
              {translate(
                'auto.components.settings.TerminalMacPtyLimitSetting.retry',
                'Retry status'
              )}
            </Button>
          ) : (
            <div className="flex flex-col items-end gap-1.5">
              {status.currentLimit >= status.maximumLimit ? (
                <SettingsBadge tone="accent">
                  {translate(
                    'auto.components.settings.TerminalMacPtyLimitSetting.maximum',
                    '{{value0}} · Maximum',
                    { value0: status.currentLimit }
                  )}
                </SettingsBadge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-36 gap-1.5"
                  disabled={isBusy}
                  onClick={() => void increaseLimit()}
                >
                  {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {isBusy
                    ? translate(
                        'auto.components.settings.TerminalMacPtyLimitSetting.waiting',
                        'Waiting for macOS…'
                      )
                    : translate(
                        'auto.components.settings.TerminalMacPtyLimitSetting.increase',
                        'Increase to {{value0}}',
                        { value0: status.maximumLimit }
                      )}
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.settings.TerminalMacPtyLimitSetting.current',
                  'Current: {{value0}} · Resets after restart',
                  { value0: status.currentLimit }
                )}
              </span>
            </div>
          )
        }
      />
    </SearchableSetting>
  )
}
