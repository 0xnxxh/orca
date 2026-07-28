import type { NativeChatTurnLifecycle } from '../../../src/shared/native-chat-types'
import type { MobileWebNativeChatAgentStatus } from '../../../src/shared/mobile-web/native-chat-operation-contract'

export function isMobileNativeChatAgentWorking(
  status: MobileWebNativeChatAgentStatus | null | undefined,
  lifecycle: NativeChatTurnLifecycle | undefined
): boolean {
  if (status?.state !== 'working') {
    return false
  }
  if (!lifecycle || lifecycle.state === 'working') {
    return true
  }
  const stateStartedAt = status.stateStartedAt
  if (
    lifecycle.timestamp === null ||
    !Number.isFinite(lifecycle.timestamp) ||
    !Number.isSafeInteger(stateStartedAt) ||
    stateStartedAt === undefined ||
    stateStartedAt < 0
  ) {
    return true
  }
  return lifecycle.timestamp < stateStartedAt
}
