import type { TerminalGitHubPRLink } from '../../shared/terminal-github-pr-link-detector'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'

export type PtyDataEvent = {
  id: string
  data: string
  incarnationId?: PtyIncarnationId
  sequenceChars?: number
  transformed?: boolean
  seq?: number
}

/** Notification-bearing fact a thinning transport detected while it held
 *  scan authority for a backgrounded PTY (see onBackgroundStreamEvent). */
export type PtyTransientFact =
  | { kind: 'bell' }
  | { kind: 'command-finished'; exitCode: number | null }
  | { kind: 'pr-link'; link: TerminalGitHubPRLink }
  | { kind: '2031-subscribe' }
  | { kind: '2031-unsubscribe' }

export type PtyBackgroundStreamEvent =
  | {
      id: string
      incarnationId?: PtyIncarnationId
      kind: 'backgroundMarker'
      background: boolean
      scanSeedAnsi?: string
      mode2031PendingSubscribe?: true
    }
  | {
      id: string
      incarnationId?: PtyIncarnationId
      kind: 'dataGap'
      droppedChars: number
      sequenceChars?: number
    }
  | {
      id: string
      incarnationId?: PtyIncarnationId
      kind: 'transientFact'
      fact: PtyTransientFact
    }
