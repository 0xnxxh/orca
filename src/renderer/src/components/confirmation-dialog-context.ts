import { createContext, useContext } from 'react'

// Why: the context stays in a component-free module so React Fast Refresh never
// rebuilds it. A module exporting both a component and this hook can never be a
// refresh boundary, so Vite applies its updates in two waves under different
// `?t=` stamps; importers refreshed in different waves then hold different
// context objects and consumers throw below until a full reload.

export type ConfirmationDialogOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'destructive'
}

export type ConfirmationDialogContextValue = (
  options: ConfirmationDialogOptions
) => Promise<boolean>

export const ConfirmationDialogContext = createContext<ConfirmationDialogContextValue | null>(null)

export function useConfirmationDialog(): ConfirmationDialogContextValue {
  const confirm = useContext(ConfirmationDialogContext)
  if (!confirm) {
    throw new Error('useConfirmationDialog must be used inside ConfirmationDialogProvider')
  }
  return confirm
}
