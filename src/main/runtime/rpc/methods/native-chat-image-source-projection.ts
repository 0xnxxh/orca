import { imageSourcePathFromText } from '../../../../shared/native-chat-image-transcript-markers'
import { isTextBlock, type NativeChatMessage } from '../../../../shared/native-chat-types'

/** Keep RPC image-source rows readable by released single-block peers. */
export function projectNativeChatRpcImageSourceMessage(
  message: NativeChatMessage
): NativeChatMessage[] {
  if (
    message.role !== 'user' ||
    message.blocks.length <= 1 ||
    !message.blocks.every(
      (block) => isTextBlock(block) && imageSourcePathFromText(block.text) !== null
    )
  ) {
    return [message]
  }
  // Why: derived IDs preserve transcript provenance across append/replacement.
  return message.blocks.map((block, index) => ({
    ...message,
    id: index === 0 ? message.id : `${message.id}:image-source:${index}`,
    blocks: [block]
  }))
}
