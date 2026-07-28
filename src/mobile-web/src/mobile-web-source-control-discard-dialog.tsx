import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog-foundation'
import { Loader2 } from 'lucide-react'
import React from 'react'
import type { MobileWebSourceControlStatusEntry } from '../../shared/mobile-web/source-control-operation-contract'
import type { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'

export function MobileWebSourceControlDiscardDialog({
  targets,
  busy,
  error,
  onCancel,
  onConfirm
}: {
  targets: MobileWebSourceControlStatusEntry[] | null
  busy: boolean
  error: MobileWebBridgeClientError | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const count = targets?.length ?? 0
  return (
    <Dialog
      open={targets !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onCancel()
        }
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Discard {count === 1 ? 'change' : `${count} changes`}?</DialogTitle>
          <DialogDescription>
            {discardDescription(targets)}
            {error ? ` ${discardErrorCopy(error)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || count === 0} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function discardDescription(targets: MobileWebSourceControlStatusEntry[] | null): string {
  if (!targets || targets.length === 0) {
    return 'This action cannot be undone.'
  }
  if (targets.length === 1) {
    return `This removes the uncommitted content in “${targets[0]!.relativePath}” from the paired Desktop and cannot be undone.`
  }
  return `This removes the selected uncommitted content from the paired Desktop and cannot be undone.`
}

function discardErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'conflict') {
    return 'The repository changed; review the refreshed status before trying again.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect before trying again.'
  }
  return 'The paired Desktop did not discard the selected changes.'
}
