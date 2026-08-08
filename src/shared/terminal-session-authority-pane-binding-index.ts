import {
  terminalPtyIncarnationKey,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'

export class TerminalAuthorityPaneBindingIndex {
  private readonly paneByPtyIncarnation = new Map<string, string>()
  private readonly bindingCountByOwner = new Map<string, number>()

  ptyOwner(binding: TerminalSessionBinding): string | null {
    return this.paneByPtyIncarnation.get(terminalPtyIncarnationKey(binding)) ?? null
  }

  ownerHasBinding(ownerIncarnationId: string): boolean {
    return this.bindingCountByOwner.has(ownerIncarnationId)
  }

  replace(
    previous: TerminalSessionBinding | null,
    next: TerminalSessionBinding | null,
    paneGenerationKey: string
  ): void {
    if (previous) {
      this.paneByPtyIncarnation.delete(terminalPtyIncarnationKey(previous))
      this.removeOwnerBinding(previous.ownerIncarnationId)
    }
    if (!next) {
      return
    }
    this.paneByPtyIncarnation.set(terminalPtyIncarnationKey(next), paneGenerationKey)
    this.bindingCountByOwner.set(
      next.ownerIncarnationId,
      (this.bindingCountByOwner.get(next.ownerIncarnationId) ?? 0) + 1
    )
  }

  private removeOwnerBinding(ownerIncarnationId: string): void {
    const count = this.bindingCountByOwner.get(ownerIncarnationId)
    if (count === undefined || count <= 1) {
      this.bindingCountByOwner.delete(ownerIncarnationId)
    } else {
      this.bindingCountByOwner.set(ownerIncarnationId, count - 1)
    }
  }
}
