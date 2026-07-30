import { CliInstaller } from '../cli/cli-installer'
import { installLinuxBareOrcaDispatcher } from '../cli/linux-bare-orca-dispatcher'
import { reconcileManagedWslCliRegistrations } from '../cli/wsl-cli-registration-reconciliation'

type CliInstallerParameters = ConstructorParameters<typeof CliInstaller>

export function createCliWslStartupCapability() {
  return {
    reconcileManagedWslCliRegistrations,
    installServeCli: (...args: CliInstallerParameters) => new CliInstaller(...args).install(),
    installLinuxBareOrcaDispatcher
  }
}
