'use client'

import { translate } from '@/i18n/i18n'
import {
  Dialog,
  DialogClose,
  DialogContent as DialogFoundationContent,
  type DialogContentProps,
  DialogDescription,
  DialogFooter as DialogFoundationFooter,
  type DialogFooterProps,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
} from './dialog-foundation'

function DialogContent(props: DialogContentProps) {
  return (
    <DialogFoundationContent
      closeLabel={translate('auto.components.ui.dialog.f26c4baeda', 'Close')}
      {...props}
    />
  )
}

function DialogFooter(props: DialogFooterProps) {
  return (
    <DialogFoundationFooter
      closeLabel={translate('auto.components.ui.dialog.f26c4baeda', 'Close')}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
