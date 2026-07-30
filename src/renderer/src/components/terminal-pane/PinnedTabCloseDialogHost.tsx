import { Suspense, useEffect, useState } from 'react'
import { loadSettingsModule } from '@/components/settings/settings-module-loader'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { useAppStore } from '@/store'

const PinnedTabCloseDialog = lazyWithRetry(
  () =>
    loadSettingsModule().then((module) => ({
      default: module.PinnedTabCloseDialog
    })),
  { reloadKey: 'pinned-tab-close-dialog' }
)

export default function PinnedTabCloseDialogHost(): React.JSX.Element | null {
  const requested = useAppStore((state) => state.pinnedTabCloseConfirm !== null)
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
      <PinnedTabCloseDialog />
    </Suspense>
  )
}
