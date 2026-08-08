import type { Session } from './session'
import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import {
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthoritySemanticFact } from '../../shared/terminal-session-authority-mutation'

export class TerminalHostAuthoritySemanticRecorder {
  constructor(
    private readonly sessions: ReadonlyMap<string, Session>,
    private readonly ptyOwner: TerminalSessionAuthorityPtyOwner | null,
    private readonly accessFor: (sessionId: string) => TerminalSessionAuthorityPtyAccess | null,
    private readonly fail: (error: unknown) => void
  ) {}

  async recordExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    fact: TerminalSessionAuthoritySemanticFact
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (
      !session?.isAlive ||
      access.binding.physicalPtyId !== sessionId ||
      access.binding.ptyIncarnationId !== session.incarnationId
    ) {
      return false
    }
    const currentAccess = this.accessFor(sessionId)
    if (!currentAccess) {
      const error = new Error('terminal_session_authority_semantic_access_missing')
      this.fail(error)
      throw error
    }
    if (
      !sameTerminalSessionAuthorityPtyAccess(currentAccess, access) ||
      !this.ptyOwner?.admits(sessionId, access)
    ) {
      return false
    }
    try {
      return await this.ptyOwner.recordSemanticOutcome(sessionId, access, fact)
    } catch (error) {
      this.fail(error)
      throw error
    }
  }
}
