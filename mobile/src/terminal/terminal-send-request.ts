import type { SendRequestOptions } from '../transport/rpc-client'

type TerminalSendParams = {
  readonly terminal: string
  readonly text: string
  readonly enter: boolean
  readonly client?: { readonly id: string; readonly type: 'mobile' }
}

// Why: keystroke-grade sends must never park in the connect wait — a send parked
// across a reconnect replays stale bytes into the PTY long after they were typed
// (#6713's `YZZYecho …` corruption of the first post-recovery command).
export const TERMINAL_INPUT_SEND_OPTIONS: SendRequestOptions = { failWhenDisconnected: true }

export function buildTerminalSendParams(args: {
  terminal: string
  text: string
  enter: boolean
  // Why: presence-lock take-floor; marks this phone active so multi-mobile contention resolves to the last actor.
  deviceToken: string | null
}): TerminalSendParams {
  return {
    terminal: args.terminal,
    text: args.text,
    enter: args.enter,
    ...(args.deviceToken ? { client: { id: args.deviceToken, type: 'mobile' as const } } : {})
  }
}
