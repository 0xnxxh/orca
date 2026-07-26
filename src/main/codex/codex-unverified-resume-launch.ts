import { dropAgentResumeArgvFromCommand } from '../../shared/agent-resume-argv-drop'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'

export const UNVERIFIED_CODEX_RESUME_ERROR =
  'Orca could not verify the originating Codex session file, so automatic resume was stopped to avoid using a different account.'

/**
 * Launch command for a Codex resume whose originating account could not be verified:
 * the resume argv is dropped so the pane starts a clean session instead of resuming
 * under whichever account is selected now (#10793). Throws only when the resume
 * locator is present but not strippable — launching then could still cross accounts.
 */
export function dropUnverifiedCodexResumeArgv(args: {
  command: string | undefined
  providerSession: AgentProviderSessionMetadata | null
}): { command: string | undefined; droppedResumeArgv: boolean } {
  if (!args.command || !args.providerSession) {
    return { command: args.command, droppedResumeArgv: false }
  }
  const drop = dropAgentResumeArgvFromCommand({
    command: args.command,
    agent: 'codex',
    providerSession: args.providerSession
  })
  if (drop.status === 'dropped') {
    return { command: drop.command, droppedResumeArgv: true }
  }
  if (drop.status === 'unrecognized') {
    throw new Error(UNVERIFIED_CODEX_RESUME_ERROR)
  }
  return { command: args.command, droppedResumeArgv: false }
}
