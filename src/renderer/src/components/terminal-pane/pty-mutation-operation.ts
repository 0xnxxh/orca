import type { PtyMutationIdentity } from '../../../../shared/pty-mutation-identity'

export type PendingPtyMutation =
  | {
      kind: 'write-accepted'
      id: string
      bindingRevision: number
      data: string
      resolve: (accepted: boolean) => void
    }
  | {
      kind: 'resize'
      id: string
      bindingRevision: number
      cols: number
      rows: number
      claim: boolean
    }
  | { kind: 'claim-viewport'; id: string; bindingRevision: number; cols: number; rows: number }
  | { kind: 'signal'; id: string; bindingRevision: number; signal: string }
  | { kind: 'clear'; id: string; bindingRevision: number }
  | {
      kind: 'kill'
      id: string
      bindingRevision: number
      keepHistory: boolean
      resolve: () => void
      reject: (error: unknown) => void
    }

export function killPtyWithMutationIdentity(
  id: string,
  keepHistory: boolean,
  identity?: PtyMutationIdentity
): Promise<void> {
  if (identity) {
    return Promise.resolve(window.api.pty.kill(id, { keepHistory, mutationIdentity: identity }))
  }
  return Promise.resolve(
    keepHistory ? window.api.pty.kill(id, { keepHistory: true }) : window.api.pty.kill(id)
  )
}
