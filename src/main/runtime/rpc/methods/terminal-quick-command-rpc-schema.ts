import { z } from 'zod'
import {
  normalizeTerminalQuickCommands,
  supportsTerminalAgentQuickCommand
} from '../../../../shared/terminal-quick-commands'

const TerminalQuickCommandScopeUpdate = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('repo'), repoId: z.string() }).strict()
])

const TerminalQuickCommandUpdateItem = z.union([
  z
    .object({
      id: z.string(),
      label: z.string(),
      action: z.literal('terminal-command').optional(),
      command: z.string(),
      appendEnter: z.boolean(),
      scope: TerminalQuickCommandScopeUpdate.optional()
    })
    .strict(),
  z
    .object({
      id: z.string(),
      label: z.string(),
      action: z.literal('agent-prompt'),
      agent: z.custom(supportsTerminalAgentQuickCommand, {
        message: 'Agent does not support prompt commands'
      }),
      prompt: z.string(),
      scope: TerminalQuickCommandScopeUpdate.optional()
    })
    .strict()
])

export const TerminalQuickCommandsUpdate = z
  .object({
    // Why: normalization drops malformed entries, which would turn a protocol
    // mismatch into destructive deletion of some or all saved commands.
    terminalQuickCommands: z
      .array(TerminalQuickCommandUpdateItem)
      .transform((value) => normalizeTerminalQuickCommands(value))
  })
  .strict()
