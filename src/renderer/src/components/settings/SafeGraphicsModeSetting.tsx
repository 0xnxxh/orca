import { useEffect, useState } from 'react'
import { Loader2, Pin, RotateCw } from 'lucide-react'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import type { GpuFallbackSource } from '../../../../shared/gpu-fallback-status'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitch } from './SettingsFormControls'
import { getAdvancedSearchEntry } from './advanced-search'

/** Deep-link anchor for the Safe Graphics Mode notice toast. */
export const SAFE_GRAPHICS_MODE_SETTING_ID = 'advanced-safe-graphics-mode'

/**
 * Safe Graphics Mode engages before any window exists and stays on for the whole
 * build, so a transient toast cannot be the only control: this is the persistent
 * surface that reports the state, offers the way back once a driver is fixed, and
 * lets a user with a known-bad driver pin the workaround across updates.
 */
export function SafeGraphicsModeSetting(): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [active, setActive] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [source, setSource] = useState<GpuFallbackSource | null>(null)
  const [confirming, setConfirming] = useState<boolean | null>(null)
  const [relaunching, setRelaunching] = useState(false)
  const [pinning, setPinning] = useState(false)

  useEffect(() => {
    const getGpuFallbackStatus = window.api?.app?.getGpuFallbackStatus
    if (!getGpuFallbackStatus) {
      return
    }
    let cancelled = false
    void getGpuFallbackStatus().then(
      (status) => {
        if (!cancelled) {
          setActive(status.active)
          setEnabled(status.enabledForNextLaunch || status.active)
          setSource(status.source)
        }
      },
      (error: unknown) => {
        console.error('[gpu-fallback] failed to read status:', error)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Converts the automatic engagement in force into the user's own standing choice.
   *
   * Why no relaunch: software rendering is already on, so the pin is a rewrite of the marker.
   * Without this the only way to reach a pin is to turn the workaround off first and take a
   * hardware launch on the driver that just proved it kills startup — the exact trade the
   * whole cross-launch rescue exists to spare this user, once per update forever.
   */
  const handlePin = (): void => {
    setPinning(true)
    void (async () => {
      try {
        await window.api.app.setGpuFallbackEnabled(true)
        if (mountedRef.current) {
          setSource('user')
          setEnabled(true)
        }
      } catch (error) {
        console.error('[gpu-fallback] failed to pin Safe Graphics Mode:', error)
      } finally {
        if (mountedRef.current) {
          setPinning(false)
        }
      }
    })()
  }

  const handleRelaunch = (target: boolean): void => {
    setRelaunching(true)
    void (async () => {
      try {
        await window.api.app.setGpuFallbackEnabled(target)
        await window.api.app.relaunch()
      } catch (error) {
        console.error('[gpu-fallback] failed to change Safe Graphics Mode:', error)
        if (mountedRef.current) {
          setRelaunching(false)
        }
      }
    })()
  }

  const pinned = source === 'user'
  // Why: only an engagement Orca made on its own is worth converting; a confirmation already
  // on screen owns the next decision, and the switch alone cannot express "on, and keep it on".
  const canPin = active && !pinned && confirming === null

  return (
    <SearchableSetting
      title={getAdvancedSearchEntry().safeGraphicsMode.title}
      description={getAdvancedSearchEntry().safeGraphicsMode.description}
      keywords={getAdvancedSearchEntry().safeGraphicsMode.keywords}
      className="space-y-2 py-2"
      id={SAFE_GRAPHICS_MODE_SETTING_ID}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 shrink space-y-1">
          <Label id={`${SAFE_GRAPHICS_MODE_SETTING_ID}-label`}>
            {translate('auto.components.settings.SafeGraphicsMode.title', 'Safe Graphics Mode')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {pinned
              ? translate(
                  'auto.components.settings.SafeGraphicsMode.pinnedDescription',
                  'On because you turned it on. Hardware acceleration stays off, including after Orca updates, until you turn this back off.'
                )
              : active
                ? translate(
                    'auto.components.settings.SafeGraphicsMode.activeDescription',
                    "Hardware acceleration is off because Orca's graphics process crashed on repeated launches. Rendering may be slower."
                  )
                : translate(
                    'auto.components.settings.SafeGraphicsMode.inactiveDescription',
                    'Off. Orca is using hardware acceleration, and turns this on by itself only after repeated graphics crashes at startup.'
                  )}
          </p>
          {canPin ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePin}
              disabled={pinning || relaunching}
              className="mt-1 gap-1.5"
            >
              {pinning ? <Loader2 className="animate-spin" /> : <Pin />}
              {translate(
                'auto.components.settings.SafeGraphicsMode.keepAfterUpdates',
                'Keep on after updates'
              )}
            </Button>
          ) : null}
        </div>
        <SettingsSwitch
          checked={confirming ?? enabled}
          onChange={() => setConfirming(confirming === null ? !enabled : null)}
          ariaLabelledBy={`${SAFE_GRAPHICS_MODE_SETTING_ID}-label`}
          disabled={relaunching}
        />
      </div>

      {confirming !== null ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium">
              {confirming
                ? translate(
                    'auto.components.settings.SafeGraphicsMode.confirmEnableTitle',
                    'Restart in Safe Graphics Mode?'
                  )
                : translate(
                    'auto.components.settings.SafeGraphicsMode.confirmTitle',
                    'Restart with hardware acceleration?'
                  )}
            </p>
            <p className="text-xs text-muted-foreground">
              {confirming
                ? translate(
                    'auto.components.settings.SafeGraphicsMode.confirmEnableDescription',
                    'Hardware acceleration stays off, including after Orca updates, until you turn this back off.'
                  )
                : translate(
                    'auto.components.settings.SafeGraphicsMode.confirmDescription',
                    'If the graphics driver still crashes, Orca returns to Safe Graphics Mode by itself after three failed launches.'
                  )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(null)}
              disabled={relaunching}
            >
              {translate('auto.components.settings.SafeGraphicsMode.cancel', 'Cancel')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRelaunch(confirming)}
              disabled={relaunching}
              className="gap-1.5"
            >
              {relaunching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCw className="size-3.5" />
              )}
              {translate('auto.components.settings.SafeGraphicsMode.restart', 'Restart')}
            </Button>
          </div>
        </div>
      ) : null}
    </SearchableSetting>
  )
}
