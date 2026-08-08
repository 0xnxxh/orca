import type { TerminalSessionAuthorityPtyAccess } from '../shared/terminal-session-authority-pty-access'
import type { LegacyPhysicalWorkerAuthorityRouterOptions } from './legacy-physical-worker-authority-session'
import type { LegacyPhysicalWorkerMutation } from './legacy-physical-worker-mutation'

type ShutdownMutation = Extract<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>

export class LegacyPhysicalWorkerAuthorityMutations {
  constructor(
    private readonly registry: LegacyPhysicalWorkerAuthorityRouterOptions['registry'],
    private readonly isDisposed: () => boolean,
    private readonly reportFault: (error: Error) => void
  ) {}

  dispatch(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: Exclude<LegacyPhysicalWorkerMutation, { kind: 'shutdown' }>
  ): Promise<boolean> {
    return this.isDisposed() ? Promise.resolve(false) : this.dispatchExact(access, mutation)
  }

  async persistAndDispatchShutdown(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: ShutdownMutation,
    persistClose: () => Promise<void>
  ): Promise<boolean> {
    await persistClose()
    if (this.isDisposed()) {
      return true
    }
    try {
      await this.dispatchExact(access, mutation)
    } catch (error) {
      this.reportFault(error instanceof Error ? error : new Error(String(error)))
    }
    return true
  }

  ensureShutdown(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: ShutdownMutation
  ): Promise<boolean> {
    return this.isDisposed() ? Promise.resolve(false) : this.dispatchExact(access, mutation)
  }

  private dispatchExact(
    access: TerminalSessionAuthorityPtyAccess,
    mutation: LegacyPhysicalWorkerMutation
  ): Promise<boolean> {
    return this.registry.dispatchPtyMutation(
      access.binding.ownerIncarnationId,
      {
        id: access.binding.physicalPtyId,
        incarnationId: access.binding.ptyIncarnationId
      },
      mutation
    )
  }
}
