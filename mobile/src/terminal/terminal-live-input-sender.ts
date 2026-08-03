export type TerminalLiveInputSender = (handle: string, bytes: string) => Promise<boolean>

export type TerminalLiveExternalInputRunner = (
  handle: string,
  operation: () => Promise<boolean>
) => Promise<boolean>
