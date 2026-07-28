import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { subscribeToMacosTccPromptNotice } from './macos-tcc-prompt-notice-subscription'

/**
 * Shows the Full Disk Access hint only after macOS has repeatedly raised its
 * consent dialog naming Orca (#9756). The main process counts the dialogs, so
 * users who never see one never see this.
 */
export function useMacosTccPromptNotice(): void {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)

  useEffect(() => {
    return subscribeToMacosTccPromptNotice(window.api?.macosTccPrompts, () => {
      toast.warning(
        translate(
          'auto.hooks.useMacosTccPromptNotice.title',
          'Reduce repeated macOS permission prompts'
        ),
        {
          description: translate(
            'auto.hooks.useMacosTccPromptNotice.description',
            'macOS credits file access by your agents and terminal tools to Orca. Granting Full Disk Access reduces these prompts.'
          ),
          duration: 12_000,
          action: {
            label: translate('auto.hooks.useMacosTccPromptNotice.openSettings', 'Open Settings'),
            onClick: () => {
              openSettingsPage()
              openSettingsTarget({ pane: 'developer-permissions', repoId: null })
            }
          },
          cancel: {
            label: translate('auto.hooks.useMacosTccPromptNotice.dismiss', "Don't show again"),
            onClick: () => {
              void window.api?.macosTccPrompts?.dismiss?.()
            }
          }
        }
      )
    })
  }, [openSettingsPage, openSettingsTarget])
}
