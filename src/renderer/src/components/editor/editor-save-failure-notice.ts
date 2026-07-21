import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

// Why: requestEditorFileSave rejects on a dropped write, but callers used to swallow it — turning a
// failed save into silent data loss (the edit stays dirty in the buffer with no signal it never
// persisted, STA-2027). Surface it so Cmd/Ctrl+S can't look successful while dropping the save.
export function notifyEditorSaveFailure(error: unknown): void {
  console.error('[editor] file save failed', error)
  toast.error(
    translate(
      'auto.components.editor.editor.save.failure.notice.8c59ce5075',
      'Failed to save the file. Please try again.'
    )
  )
}
