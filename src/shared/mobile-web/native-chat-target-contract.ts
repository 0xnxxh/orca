import { z } from 'zod'
import { MobileWebWorkspaceIdSchema } from './workspace-operation-contract'

export const MobileWebNativeChatSessionIdSchema = z
  .string()
  .regex(/^native_chat_[a-z0-9]+_[a-f0-9]{32}$/)

export const MobileWebNativeChatTargetShape = {
  workspaceId: MobileWebWorkspaceIdSchema,
  sessionId: MobileWebNativeChatSessionIdSchema
} as const
