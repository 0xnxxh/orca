import type { SshTarget } from '../../shared/ssh-types'

export const SSH_PTY_SOURCE_CREDIT_V1_ENV = 'ORCA_SSH_PTY_SOURCE_CREDIT_V1'

function readSshPtySourceCreditV1Override(env: NodeJS.ProcessEnv): boolean | undefined {
  const value = env[SSH_PTY_SOURCE_CREDIT_V1_ENV]
  return value === undefined ? undefined : value === '1'
}

export function resolveSshPtySourceCreditV1Selection(
  target: Pick<SshTarget, 'experimentalPtySourceCreditV1'>,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return readSshPtySourceCreditV1Override(env) ?? target.experimentalPtySourceCreditV1 === true
}

export class SshPtySourceCreditRestartRequiredError extends Error {
  readonly code = 'ssh_pty_source_credit_restart_required'

  constructor() {
    super(
      'SSH PTY source credit was enabled after this detached relay started. Reset the relay, then reconnect to launch it with source-credit support.'
    )
    this.name = 'SshPtySourceCreditRestartRequiredError'
  }
}

export function assertSshPtySourceCreditRelayLaunchPolicy(
  enabled: boolean,
  relayPolicy: string
): void {
  if (enabled && relayPolicy !== 'v1') {
    throw new SshPtySourceCreditRestartRequiredError()
  }
}
