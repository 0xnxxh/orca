import type { PtyIncarnationId } from '../../shared/pty-incarnation'

export type DaemonPtyRouterDataEvent = {
  id: string
  data: string
  incarnationId?: PtyIncarnationId
  sequenceChars?: number
  transformed?: boolean
  seq?: number
}

export type DaemonPtyRouterExitEvent = {
  id: string
  code: number
  incarnationId?: PtyIncarnationId
}
