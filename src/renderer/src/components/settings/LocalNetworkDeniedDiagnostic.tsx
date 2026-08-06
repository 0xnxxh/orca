import { translate } from '@/i18n/i18n'

/**
 * Inline note for macOS's denied-without-prompt Local Network state (STA-3505):
 * NECP can deny the whole process tree silently and leave the app out of the
 * System Settings list, so the user needs the diagnosis and workaround here.
 */
export function LocalNetworkDeniedDiagnostic(): React.JSX.Element {
  return (
    <p data-testid="local-network-denied-diagnostic" className="text-xs text-destructive">
      {translate(
        'auto.components.settings.DeveloperPermissionsPane.localNetworkDeniedDiagnostic',
        'macOS denied local network access without showing a prompt. On macOS betas the OS may also leave Orca out of System Settings → Privacy & Security → Local Network, so there is nothing to toggle.'
      )}{' '}
      {translate(
        'auto.components.settings.DeveloperPermissionsPane.localNetworkDeniedWorkaround',
        'Workaround: in Terminal run "sudo killall nesessionmanager nehelper", then unplug and replug your network connection so macOS re-evaluates access, and trigger the prompt again.'
      )}
    </p>
  )
}
