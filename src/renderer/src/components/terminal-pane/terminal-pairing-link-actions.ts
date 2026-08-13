import { parseHostAccessLink } from '../../../../shared/remote-pairing-address'
import { translate } from '@/i18n/i18n'
import { toast } from 'sonner'

export function copyTerminalPairingLink(accessLink: string): boolean {
  if (!isTerminalPairingLink(accessLink)) {
    return false
  }
  void window.api.ui
    .writeClipboardText(accessLink)
    .then(() => {
      toast.success(
        translate(
          'auto.components.terminal.pane.TerminalLinkActionPopover.accessLinkCopied',
          'Access link copied'
        )
      )
    })
    .catch(() => {
      toast.error(
        translate(
          'auto.components.terminal.pane.TerminalLinkActionPopover.copyAccessLinkFailed',
          'Failed to copy access link'
        )
      )
    })
  return true
}

export function isTerminalPairingLink(accessLink: string): boolean {
  return parseHostAccessLink(accessLink).ok
}
