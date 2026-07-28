export const SSH_PTY_SOURCE_CREDIT_V1_ENV = 'ORCA_SSH_PTY_SOURCE_CREDIT_V1'

function readSshPtySourceCreditV1Selection(env: NodeJS.ProcessEnv): boolean {
  return env[SSH_PTY_SOURCE_CREDIT_V1_ENV] === '1'
}

const SSH_PTY_SOURCE_CREDIT_V1_STARTUP_SELECTION = readSshPtySourceCreditV1Selection(process.env)

export function isSshPtySourceCreditV1Enabled(env?: NodeJS.ProcessEnv): boolean {
  return env ? readSshPtySourceCreditV1Selection(env) : SSH_PTY_SOURCE_CREDIT_V1_STARTUP_SELECTION
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
