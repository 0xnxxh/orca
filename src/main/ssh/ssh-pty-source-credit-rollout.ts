export const SSH_PTY_SOURCE_CREDIT_V1_ENV = 'ORCA_SSH_PTY_SOURCE_CREDIT_V1'

export function isSshPtySourceCreditV1Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SSH_PTY_SOURCE_CREDIT_V1_ENV] === '1'
}
