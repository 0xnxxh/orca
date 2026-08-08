import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { sshRelayDeadlineOptions } from './ssh-relay-request-deadline'

export type SshPtyShutdownOptions = Readonly<{
  immediate?: boolean
  keepHistory?: boolean
  deadlineMs?: number
}>

export async function shutdownSshPty(args: {
  mux: SshChannelMultiplexer
  relayPtyId: string
  options: SshPtyShutdownOptions
}): Promise<void> {
  await args.mux.request(
    'pty.shutdown',
    {
      id: args.relayPtyId,
      immediate: args.options.immediate ?? false,
      keepHistory: args.options.keepHistory ?? false
    },
    sshRelayDeadlineOptions(args.options.deadlineMs)
  )
}
