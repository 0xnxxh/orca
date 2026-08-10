import type { AgentType, NativeChatMessage } from '../../../../shared/native-chat-types'

export type NativeChatWorkingInterruption = {
  paneKey: string
  agent: AgentType
  sessionId: string | null
  workingEpoch: number | null
  userTurnKey: string | null
}

export function latestNativeChatUserTurnKey(messages: NativeChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') {
      return message.turnId ?? message.id
    }
  }
  return null
}

export function shouldSuppressNativeChatWorking(args: {
  working: boolean
  paneKey: string
  agent: AgentType
  sessionId: string | null
  workingEpoch: number | null
  userTurnKey: string | null
  interruption: NativeChatWorkingInterruption | null
}): boolean {
  const { interruption } = args
  if (
    !args.working ||
    interruption === null ||
    interruption.paneKey !== args.paneKey ||
    interruption.agent !== args.agent ||
    interruption.sessionId !== args.sessionId ||
    interruption.userTurnKey !== args.userTurnKey
  ) {
    return false
  }
  return (
    interruption.workingEpoch == null ||
    args.workingEpoch == null ||
    args.workingEpoch <= interruption.workingEpoch
  )
}

export function shouldShowNativeChatWorking(args: {
  isConversation: boolean
  working: boolean
  interrupted: boolean
}): boolean {
  return args.isConversation && args.working && !args.interrupted
}
