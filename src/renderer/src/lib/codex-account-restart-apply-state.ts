import type { GlobalSettings } from '../../../shared/types'

type CodexAccountRestartTransport = {
  getPtyId: () => string | null
}

export function getSelectedHostCodexAccountId(
  settings:
    | Pick<GlobalSettings, 'activeCodexManagedAccountId' | 'activeCodexManagedAccountIdsByRuntime'>
    | null
    | undefined
): string | null {
  return (
    settings?.activeCodexManagedAccountIdsByRuntime?.host ??
    settings?.activeCodexManagedAccountId ??
    null
  )
}

export function resolveCodexAccountRestartApplyState(args: {
  capturedTransport: CodexAccountRestartTransport | undefined
  currentTransport: CodexAccountRestartTransport | undefined
  capturedPtyId: string | null | undefined
  capturedHostAccountId: string | null
  currentHostAccountId: string | null
}): 'apply' | 'target-replaced' | 'selection-changed' {
  if (
    args.currentTransport !== args.capturedTransport ||
    args.currentTransport?.getPtyId() !== args.capturedPtyId
  ) {
    return 'target-replaced'
  }
  return args.currentHostAccountId === args.capturedHostAccountId ? 'apply' : 'selection-changed'
}
