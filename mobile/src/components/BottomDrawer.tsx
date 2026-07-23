import { type ReactNode, useState } from 'react'
import { resolveBottomDrawerMounted } from './bottom-drawer-mount-state'
import { BOTTOM_DRAWER_HIDE_DURATION_MS } from './bottom-drawer-constants'
import { MountedBottomDrawer } from './mounted-bottom-drawer'

export { BOTTOM_DRAWER_HIDE_DURATION_MS }

type Props = {
  visible: boolean
  onClose: () => void
  onAfterClose?: () => void
  children: ReactNode
  dragContentToDismiss?: boolean
  contentScrollable?: boolean
  // Why: smart-source (and similar) need a stable outer frame so a docked
  // TextInput can sit above the keyboard while results reflow in flex space
  // above it — content-sized sheets make that field ride every list change.
  fillAvailable?: boolean
  zIndex?: number
}

export function BottomDrawer({
  visible,
  onClose,
  onAfterClose,
  children,
  dragContentToDismiss = true,
  contentScrollable = true,
  fillAvailable = false,
  zIndex
}: Props) {
  const [mounted, setMounted] = useState(visible)
  const resolvedMounted = resolveBottomDrawerMounted(visible, mounted)

  // Why: opening drawers should mount before commit; waiting for a passive
  // Effect adds a null render before every drawer can animate in.
  if (resolvedMounted !== mounted) {
    setMounted(resolvedMounted)
  }

  // Why: hidden drawers are rendered by parent screens even while closed; keep
  // their Reanimated/Gesture setup out of hot paths like commit-message typing.
  if (!resolvedMounted) {
    return null
  }

  return (
    <MountedBottomDrawer
      visible={visible}
      onClose={onClose}
      onHidden={() => {
        setMounted(false)
        onAfterClose?.()
      }}
      dragContentToDismiss={dragContentToDismiss}
      contentScrollable={contentScrollable}
      fillAvailable={fillAvailable}
      zIndex={zIndex}
    >
      {children}
    </MountedBottomDrawer>
  )
}
