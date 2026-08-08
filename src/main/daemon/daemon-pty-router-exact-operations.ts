import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { IPtyProvider, PtyHeldProducerPauseToken, PtyMutationMode } from '../providers/types'

export abstract class DaemonPtyExactOperationRouter {
  protected abstract exactProviderFor(id: string): IPtyProvider | null

  supportsExactPtyOperations(id: string): boolean {
    return this.exactProviderFor(id)?.supportsExactPtyOperations?.(id) === true
  }

  getPtyMutationMode(id: string): PtyMutationMode {
    return this.exactProviderFor(id)?.getPtyMutationMode?.(id) ?? 'unavailable'
  }

  supportsExactHeldProducerPause(id: string, incarnationId: string): boolean {
    return this.exactProviderFor(id)?.supportsExactHeldProducerPause?.(id, incarnationId) === true
  }

  async acquireExactHeldProducerPause(
    id: string,
    incarnationId: string,
    token: PtyHeldProducerPauseToken
  ): Promise<boolean> {
    return (
      (await this.exactProviderFor(id)?.acquireExactHeldProducerPause?.(
        id,
        incarnationId,
        token
      )) ?? false
    )
  }

  async releaseExactHeldProducerPause(
    id: string,
    incarnationId: string,
    token: PtyHeldProducerPauseToken
  ): Promise<boolean> {
    return (
      (await this.exactProviderFor(id)?.releaseExactHeldProducerPause?.(
        id,
        incarnationId,
        token
      )) ?? false
    )
  }

  writeExact(id: string, incarnationId: string, data: string): boolean {
    return this.exactProviderFor(id)?.writeExact?.(id, incarnationId, data) === true
  }

  writeAuthorityExact(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess,
    data: string
  ): boolean {
    return this.exactProviderFor(id)?.writeAuthorityExact?.(id, authorityAccess, data) === true
  }

  resizeExact(id: string, incarnationId: string, cols: number, rows: number): boolean {
    return this.exactProviderFor(id)?.resizeExact?.(id, incarnationId, cols, rows) === true
  }

  resizeAuthorityExact(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess,
    cols: number,
    rows: number
  ): boolean {
    return (
      this.exactProviderFor(id)?.resizeAuthorityExact?.(id, authorityAccess, cols, rows) === true
    )
  }

  async killExact(
    id: string,
    incarnationId: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<boolean> {
    return (await this.exactProviderFor(id)?.killExact?.(id, incarnationId, opts)) ?? false
  }

  async killAuthorityExact(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<boolean> {
    return (
      (await this.exactProviderFor(id)?.killAuthorityExact?.(id, authorityAccess, opts)) ?? false
    )
  }

  async sendSignalExact(id: string, incarnationId: string, signal: string): Promise<boolean> {
    return (await this.exactProviderFor(id)?.sendSignalExact?.(id, incarnationId, signal)) ?? false
  }

  async sendSignalAuthorityExact(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess,
    signal: string
  ): Promise<boolean> {
    return (
      (await this.exactProviderFor(id)?.sendSignalAuthorityExact?.(id, authorityAccess, signal)) ??
      false
    )
  }

  async clearBufferExact(id: string, incarnationId: string): Promise<boolean> {
    return (await this.exactProviderFor(id)?.clearBufferExact?.(id, incarnationId)) ?? false
  }

  async clearBufferAuthorityExact(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess
  ): Promise<boolean> {
    return (
      (await this.exactProviderFor(id)?.clearBufferAuthorityExact?.(id, authorityAccess)) ?? false
    )
  }

  bindTerminalSessionAuthorityAccess(
    id: string,
    authorityAccess: TerminalSessionAuthorityPtyAccess
  ): boolean {
    return (
      this.exactProviderFor(id)?.bindTerminalSessionAuthorityAccess?.(id, authorityAccess) === true
    )
  }

  getTerminalSessionAuthorityAccess(id: string): TerminalSessionAuthorityPtyAccess | null {
    return this.exactProviderFor(id)?.getTerminalSessionAuthorityAccess?.(id) ?? null
  }

  getPtyMutationRouteToken(id: string): object | null {
    const provider = this.exactProviderFor(id)
    if (!provider?.getPtyMutationRouteToken) {
      return null
    }
    try {
      return provider.getPtyMutationRouteToken(id)
    } catch {
      return null
    }
  }
}
