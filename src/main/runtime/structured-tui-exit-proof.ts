import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionProcessIdentity } from '../../shared/agent-session-record'
import { probeAgentSessionProcessIdentity } from './agent-session-process-identity-probe'

type ExitProofInput = {
  identity: AgentSessionProcessIdentity
  waitForExit: () => Promise<unknown>
  probe?: (identity: AgentSessionProcessIdentity) => Promise<AgentSessionOwnerProbe>
}

export async function waitForStructuredTuiExitProof(input: ExitProofInput): Promise<void> {
  try {
    await input.waitForExit()
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'terminal_handle_stale') {
      throw error
    }
    const proof = await (
      input.probe ?? ((identity) => probeAgentSessionProcessIdentity({ identity }))
    )(input.identity)
    if (proof.outcome === 'pid-absent' || proof.outcome === 'identity-mismatch') {
      return
    }
    throw error
  }
}
