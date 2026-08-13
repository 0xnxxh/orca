import type React from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { GLOBAL_WORKTREE_VISIBILITY_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'
import { useAppStore } from '@/store'

function openGlobalWorktreeVisibilitySettings(): void {
  const store = useAppStore.getState()
  store.closeModal()
  store.openSettingsTarget({
    pane: 'general',
    repoId: null,
    sectionId: GLOBAL_WORKTREE_VISIBILITY_SETTINGS_TARGET_ID
  })
  store.openSettingsPage()
}

function GlobalSettingsButton(): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className="h-auto w-fit px-0"
      onClick={openGlobalWorktreeVisibilitySettings}
    >
      <Settings className="size-3.5" />
      {translate(
        'auto.components.sidebar.WorktreeVisibilityDialog.openGlobalSettings',
        'Manage in Global Settings'
      )}
    </Button>
  )
}

export function WorktreeVisibilityGlobalSettingsLink({
  hasGloballyShownSource
}: {
  hasGloballyShownSource: boolean
}): React.JSX.Element {
  if (!hasGloballyShownSource) {
    return <GlobalSettingsButton />
  }

  return (
    <div className="grid gap-1 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.sidebar.WorktreeVisibilityDialog.globalSettingsApply',
          'Sources enabled in Global Settings also apply to this project.'
        )}
      </p>
      <GlobalSettingsButton />
    </div>
  )
}
