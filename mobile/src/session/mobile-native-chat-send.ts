import type { RpcClient } from '../transport/rpc-client'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'

type MobileTerminalClient = {
  id: string
  type: 'mobile'
}

// Why: Ctrl+U kills the TUI's current input line (desktop native chat sends the
// same byte before its body), so a launch-context prefill parked there cannot
// concatenate with a mobile chat message. The host writes text bytes verbatim.
const CLEAR_UNSUBMITTED_INPUT = '\x15'

export async function sendMobileNativeChatMessage(args: {
  client: RpcClient
  terminal: string
  text: string
  enter?: boolean
  clearInputFirst?: boolean
  mobileClient?: MobileTerminalClient
}): Promise<boolean> {
  try {
    const response = await args.client.sendRequest('terminal.send', {
      terminal: args.terminal,
      text: args.clearInputFirst ? `${CLEAR_UNSUBMITTED_INPUT}${args.text}` : args.text,
      enter: args.enter ?? true,
      ...(args.mobileClient ? { client: args.mobileClient } : {})
    })
    return isTerminalSendRpcAccepted(response)
  } catch {
    return false
  }
}
