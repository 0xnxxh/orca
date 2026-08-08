import { TerminalAuthorityAppAdmissionRejectedError } from './terminal-authority-app-outcome-host-contract'

const DEFINITIVE_ADMISSION_REJECTIONS = [
  'terminal authority namespace admission start is invalid',
  'terminal authority namespace admission proof is invalid',
  'terminal authority namespace admission retry changed',
  'terminal authority namespace admission challenge is stale',
  'terminal authority namespace admission challenge expired',
  'terminal authority namespace admission proof was rejected',
  'terminal authority namespace admission CAS changed',
  'terminal authority namespace admission targets another namespace',
  'terminal authority namespace admission transport changed',
  'terminal authority namespace admission request changed',
  'terminal authority namespace admission reservation is stale',
  'terminal authority namespace admission preparation is stale',
  'terminal authority namespace admission did not commit its claim',
  'terminal authority authenticated consumer host changed'
] as const

export function terminalAuthorityAppAdmissionRejection(
  value: unknown
): TerminalAuthorityAppAdmissionRejectedError | null {
  if (!(value instanceof Error)) {
    return null
  }
  return DEFINITIVE_ADMISSION_REJECTIONS.some((message) => value.message.startsWith(message))
    ? new TerminalAuthorityAppAdmissionRejectedError(value.message)
    : null
}
