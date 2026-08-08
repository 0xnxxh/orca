// Parser output is cached on disk across app versions: if a change here alters
// the cached Codex `title` it resolves, bump PARSER_REVISION in
// session-parse-cache-persistence.ts or stale sessions are served from disk.
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { SessionFileCandidate } from './session-scanner-types'
import { readCodexSessionIndexTitle } from './session-scanner-codex-title-index'

export async function refreshCachedCodexTitle(
  candidate: SessionFileCandidate,
  session: AiVaultSession
): Promise<AiVaultSession> {
  const title = await readCodexSessionIndexTitle(
    candidate.file.path,
    candidate.codexHome,
    session.sessionId
  )
  return title && title !== session.title ? { ...session, title } : session
}
