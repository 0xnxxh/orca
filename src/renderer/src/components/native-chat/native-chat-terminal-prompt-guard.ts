import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { detectTerminalWaitBlockedReason } from '../../../../shared/terminal-wait-blocked-detection'

export function guardNativeChatTerminalPrompt(
  classification: string,
  readTerminalScreen: (() => string | null) | undefined,
  onSwitchToTerminal: (() => void) | undefined
): boolean {
  const screen = classification === 'chat' ? readTerminalScreen?.() : null
  if (!screen || detectTerminalWaitBlockedReason(screen) === null) {
    return false
  }
  toast.info(
    translate(
      'components.native-chat.composer.finishTerminalPrompt',
      'Finish the terminal prompt before sending'
    )
  )
  onSwitchToTerminal?.()
  return true
}
