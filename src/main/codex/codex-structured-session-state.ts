import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import type {
  CodexAppServerConnection,
  openCodexAppServerConnection
} from './codex-app-server-connection'
import { CodexAcquisitionWindow } from './codex-structured-acquisition-window'
import type { CodexJournalTranslator } from './codex-structured-journal-translation'

export type CodexStructuredLaunch = {
  command: string
  args: string[]
  cwd: string
  codexHome: string | null
  resumeThreadId: string | null
}

export type CodexStructuredSessionEvent =
  | { type: 'notification'; sessionId: string; threadId: string; method: string; params: unknown }
  | {
      type: 'prompt'
      sessionId: string
      threadId: string
      method: string
      params: unknown
      codexItemId: string
      promptKey: string
    }
  | { type: 'ended'; sessionId: string; reason: string }

export type CodexStructuredSessionAdapterDeps = {
  resolveLaunch: (input: {
    identity: AgentSessionJournalIdentity
  }) => Promise<CodexStructuredLaunch>
  onEvent?: (event: CodexStructuredSessionEvent) => void
  openConnection?: typeof openCodexAppServerConnection
  readProcessStartTime?: (pid: number) => Promise<number | null>
  mintLinkId?: () => string
  now?: () => number
  requestTimeoutMs?: number
}

export type CodexSession = {
  connection: CodexAppServerConnection
  threadId: string
  historyPath: string | null
  prompts: CodexAcquisitionWindow['prompts']
  options: Map<string, string>
  turnIdWaiters: ((turnId: string) => void)[]
  translator: CodexJournalTranslator | null
}

export type CodexAcquisitionAttempt = {
  window: CodexAcquisitionWindow
  cancelled: boolean
  finished: Promise<void>
  finish: () => void
}

export function createCodexAcquisitionAttempt(): CodexAcquisitionAttempt {
  let finish = (): void => {}
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { window: new CodexAcquisitionWindow(), cancelled: false, finished, finish }
}
