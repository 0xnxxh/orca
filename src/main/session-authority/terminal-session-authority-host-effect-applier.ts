import type { TerminalSessionAuthorityEffect } from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

export type TerminalAuthorityBindingRetiredEffect = Extract<
  TerminalSessionAuthorityEffect,
  { kind: 'binding-retired' }
>

export type TerminalSessionAuthorityHostEffectApplier = Readonly<{
  ensureBindingRetired(
    access: TerminalSessionAuthorityPtyAccess,
    reason: TerminalAuthorityBindingRetiredEffect['reason']
  ): Promise<void>
}>

export class TerminalSessionAuthorityHostEffectApplierSlot implements TerminalSessionAuthorityHostEffectApplier {
  private applier: TerminalSessionAuthorityHostEffectApplier | null = null

  install(applier: TerminalSessionAuthorityHostEffectApplier): () => void {
    if (this.applier) {
      throw new Error('terminal session authority host effect applier is already installed')
    }
    this.applier = applier
    return () => {
      if (this.applier === applier) {
        this.applier = null
      }
    }
  }

  isInstalled(): boolean {
    return this.applier !== null
  }

  async ensureBindingRetired(
    access: TerminalSessionAuthorityPtyAccess,
    reason: TerminalAuthorityBindingRetiredEffect['reason']
  ): Promise<void> {
    if (!this.applier) {
      throw new Error('terminal session authority host effect applier is unavailable')
    }
    await this.applier.ensureBindingRetired(access, reason)
  }
}
