import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

type TccPromptNoticePayload = {
  promptCount: number
  accessingBinaryName?: string
}

/**
 * Shows the Full Disk Access hint only after macOS has repeatedly raised its
 * consent dialog naming Orca (#9756). The main process counts the dialogs, so
 * users who never see one never see this.
 */
export function useMacosTccPromptNotice(): void {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)

  useEffect(() => {
    const subscribe = window.api?.macosTccPrompts?.onThreshold
    if (!subscribe) {
      return
    }
    return subscribe((payload: TccPromptNoticePayload) => {
      const binary = payload.accessingBinaryName
      toast.warning(
        binary
          ? translate(
              'auto.hooks.useMacosTccPromptNotice.titleWithBinary',
              'macOS keeps asking about "{{binary}}" reading other apps\' data'
            ).replace('{{binary}}', binary)
          : translate(
              'auto.hooks.useMacosTccPromptNotice.title',
              "macOS keeps asking about access to other apps' data"
            ),
        {
          description: translate(
            'auto.hooks.useMacosTccPromptNotice.description',
            'It names Orca because Orca runs your terminal commands. Full Disk Access reduces these prompts.'
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
