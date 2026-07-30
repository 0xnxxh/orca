import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { Circle, XCircle } from 'lucide-react'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'
import { useSkillFreshness } from '@/hooks/skill-freshness'
import { loadSettingsModule } from '@/components/settings/settings-module-loader'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  getSkillFreshnessUpdateDialogRequest,
  subscribeSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'
import {
  acknowledgeSkillUpdateRun,
  cancelSkillUpdateRun,
  startSkillUpdateRun,
  useSkillUpdateRun
} from './skill-update-run-store'

const ROW_STATE_ICONS = { failed: XCircle, pending: Circle }

const SkillFreshnessUpdateDialog = lazyWithRetry(
  () =>
    loadSettingsModule().then((module) => ({
      default: module.SkillFreshnessUpdateDialog
    })),
  { reloadKey: 'skill-freshness-update-dialog' }
)

export function SkillFreshnessUpdateDialogHost(): React.JSX.Element | null {
  useSkillUpdateRun()
  const requested = useSyncExternalStore(
    subscribeSkillFreshnessUpdateDialog,
    getSkillFreshnessUpdateDialogRequest,
    getSkillFreshnessUpdateDialogRequest
  )
  const [mounted, setMounted] = useState(requested)

  useEffect(() => {
    if (requested) {
      setMounted(true)
    }
  }, [requested])

  if (!mounted) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <SkillFreshnessUpdateDialog
        acknowledgeUpdateRun={acknowledgeSkillUpdateRun}
        cancelUpdateRun={cancelSkillUpdateRun}
        consumeOpenRequest={consumeSkillFreshnessUpdateDialogRequest}
        getOpenRequest={getSkillFreshnessUpdateDialogRequest}
        notifyInstalledSkillsChanged={notifyInstalledAgentSkillsChanged}
        rowStateIcons={ROW_STATE_ICONS}
        startUpdateRun={startSkillUpdateRun}
        subscribeOpenRequest={subscribeSkillFreshnessUpdateDialog}
        useFreshness={useSkillFreshness}
        useUpdateRun={useSkillUpdateRun}
      />
    </Suspense>
  )
}
