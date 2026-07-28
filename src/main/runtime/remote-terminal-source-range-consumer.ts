import type { TerminalOutputSourceRange } from '../../shared/terminal-output-source-range'

export type RemoteTerminalSourceRangeStreamIdentity = Readonly<{
  ptyId: string
  consumerId: string
  streamGeneration: string
}>

export type RemoteTerminalSourceRangeConsumerHooks = {
  attach: (identity: RemoteTerminalSourceRangeStreamIdentity) => boolean
  settle: (
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[]
  ) => void
  transfer: (
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[],
    reason: string
  ) => void
  cancel: (
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[],
    reason: string
  ) => void
}
