import type { PtyMutationAccess } from '../../../../shared/pty-mutation-identity'

export type BoundPtyMutationAccess = Exclude<PtyMutationAccess, { mode: 'unavailable' }>

export type PtyMutationBindingTarget = Readonly<{
  id: string
  bindingRevision: number
  access: BoundPtyMutationAccess
}>

export function samePtyMutationBindingTarget(
  left: PtyMutationBindingTarget,
  right: PtyMutationBindingTarget
): boolean {
  return left.id === right.id && left.bindingRevision === right.bindingRevision
}
