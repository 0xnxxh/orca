export class TerminalAuthorityTopologyStreamValidationError extends Error {
  readonly name = 'TerminalAuthorityTopologyStreamValidationError'
}

export function failTerminalAuthorityTopologyStreamValidation(message: string): never {
  throw new TerminalAuthorityTopologyStreamValidationError(message)
}
