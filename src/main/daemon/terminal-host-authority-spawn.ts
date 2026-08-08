import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { Session } from './session'
import { TerminalHostAuthoritySubprocessGate } from './terminal-host-authority-subprocess-gate'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { TerminalHostAuthoritySessionDependencies } from './terminal-host-authority-sessions'
import type { TerminalHostSessionCreationHooks } from './terminal-host-session-create'
import type { CreateOrAttachResult } from './terminal-host-create-contract'
import type { TerminalAuthorityPreparedPtySpawn } from '../session-authority/terminal-session-authority-pty-binding'
import { authorityTerminalStreamClient } from './terminal-host-authority-consumer-routing'

export async function spawnTerminalHostAuthoritySession(args: {
  options: InternalCreateOrAttachOptions
  prepared: TerminalAuthorityPreparedPtySpawn
  ptyOwner: TerminalSessionAuthorityPtyOwner
  dependencies: TerminalHostAuthoritySessionDependencies
  accessBySession: Map<string, TerminalSessionAuthorityPtyAccess>
  pendingSessions: Set<Session>
  fail: (error: unknown) => void
}): Promise<CreateOrAttachResult> {
  let gate: TerminalHostAuthoritySubprocessGate | null = null
  const creationHooks: TerminalHostSessionCreationHooks = {
    wrapSubprocess: (subprocess) => {
      gate = new TerminalHostAuthoritySubprocessGate(subprocess)
      return gate
    },
    onSpawnFailure: async () => {
      try {
        await args.ptyOwner.cancelSpawn(args.prepared)
      } catch (error) {
        args.fail(error)
        throw error
      }
    },
    beforePublish: async (session) => {
      args.pendingSessions.add(session)
      const access = await args.ptyOwner.commitSpawn(args.prepared, session.incarnationId)
      if (!gate || gate.exceededCapacity) {
        throw new Error('terminal_session_authority_early_output_capacity_exceeded')
      }
      args.accessBySession.set(args.options.sessionId, access)
      args.options.streamClient.onAuthorityAccess?.(access)
      return access
    },
    afterPublish: (session) => {
      args.pendingSessions.delete(session)
      gate!.release()
    },
    onPostDispatchFailure: (error) => {
      gate?.releaseForShutdown()
      args.fail(error)
    }
  }
  return await args.dependencies.createPhysical(
    {
      ...args.options,
      streamClient: authorityTerminalStreamClient(args.options, true)
    },
    creationHooks
  )
}
