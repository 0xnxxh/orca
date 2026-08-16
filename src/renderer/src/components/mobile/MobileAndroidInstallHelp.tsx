import { translate } from '@/i18n/i18n'

type MobileAndroidInstallHelpProps = {
  onOpenGuide: () => void
}

export function MobileAndroidInstallHelp({
  onOpenGuide
}: MobileAndroidInstallHelpProps): React.JSX.Element {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-foreground">
        {translate('auto.components.mobile.MobileHero.androidHelp.title', 'APK trouble?')}
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
        <li>
          {translate(
            'auto.components.mobile.MobileHero.androidHelp.fullBrowser',
            'Open the link in a full browser, not an in-app browser.'
          )}
        </li>
        <li>
          {translate(
            'auto.components.mobile.MobileHero.androidHelp.downloads',
            'Open app-release.apk from Downloads and allow only the app opening it to install unknown apps.'
          )}
        </li>
        <li>
          {translate(
            'auto.components.mobile.MobileHero.androidHelp.samsung',
            'On Samsung, temporarily turn off Auto Blocker, then turn it back on after installing.'
          )}
        </li>
      </ul>
      <button type="button" className="mp-text-link mt-2" onClick={onOpenGuide}>
        {translate(
          'auto.components.mobile.MobileHero.androidHelp.guide',
          'Full Android install guide'
        )}
      </button>
    </div>
  )
}
