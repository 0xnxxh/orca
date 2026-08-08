import type { PtyTransport, PtyTransportInputTarget } from './pty-transport'

type TerminalPastePtyWriter = Pick<
  PtyTransport,
  'sendInput' | 'sendInputAccepted' | 'sendInputToTarget' | 'sendInputAcceptedToTarget'
>

export function writeTerminalPastePtyInput(
  transport: TerminalPastePtyWriter | undefined,
  data: string,
  target?: PtyTransportInputTarget | null
): boolean | Promise<boolean> {
  if (!transport) {
    return false
  }
  if (target) {
    return (
      transport.sendInputAcceptedToTarget?.(target, data) ??
      transport.sendInputToTarget?.(target, data) ??
      false
    )
  }
  // Why: paste chunking must respect PTY backpressure. sendInput only queues
  // local writes, while sendInputAccepted resolves after the PTY accepts them.
  return transport.sendInputAccepted?.(data) ?? transport.sendInput(data)
}
