import { Button } from '@renderer/components/ui/button'
import { Loader2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { MOBILE_WEB_FILE_EDIT_MAX_BYTES } from '../../shared/mobile-web/file-edit-contract'
import type { MobileWebFileEditorState } from './use-mobile-web-file-editor'

export function MobileWebFileEditor({
  editor,
  connected,
  onChange,
  onSave,
  onCancel
}: {
  editor: Exclude<MobileWebFileEditorState, { status: 'idle' }>
  connected: boolean
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [showSaving, setShowSaving] = useState(false)
  const byteLength = new TextEncoder().encode(editor.draft).byteLength
  const tooLarge = byteLength > MOBILE_WEB_FILE_EDIT_MAX_BYTES
  const unchanged = editor.draft === editor.initialContent

  useEffect(() => {
    if (editor.status !== 'saving') {
      setShowSaving(false)
      return
    }
    const timer = window.setTimeout(() => setShowSaving(true), 200)
    return () => window.clearTimeout(timer)
  }, [editor.status])

  return (
    <div className="border-t border-border">
      <textarea
        aria-label={`Edit ${editor.relativePath}`}
        className="min-h-64 w-full resize-y bg-input px-4 py-3 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={editor.draft}
        disabled={editor.status === 'saving'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {editor.status === 'error' ? (
        <p role="alert" className="border-t border-border px-4 py-2 text-xs text-destructive">
          {fileEditErrorCopy(editor.error.code)}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className={tooLarge ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {byteLength.toLocaleString()} / {MOBILE_WEB_FILE_EDIT_MAX_BYTES.toLocaleString()} bytes
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={editor.status === 'saving'}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="w-20"
            size="sm"
            disabled={!connected || unchanged || tooLarge || editor.status === 'saving'}
            onClick={onSave}
          >
            {showSaving ? <Loader2 className="animate-spin" /> : null}
            {showSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function fileEditErrorCopy(code: string): string {
  if (code === 'conflict') {
    return 'This file changed on the desktop. Cancel and reopen it before saving.'
  }
  if (code === 'too_large') {
    return 'Mobile editing is limited to 128 KiB of UTF-8 text.'
  }
  if (code === 'not_connected') {
    return 'Reconnect to the paired desktop before saving.'
  }
  return 'The paired desktop could not save this file.'
}
