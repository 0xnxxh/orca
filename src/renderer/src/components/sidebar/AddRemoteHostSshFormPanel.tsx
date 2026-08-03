import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EditingTarget } from '../settings/ssh-target-draft'
import { SshHostFields } from './AddRemoteHostFields'

export function AddRemoteHostSshFormPanel({
  form,
  disabled,
  preferAdvancedOpen,
  configIdentityAlias,
  onFormChange,
  onSubmit,
  onCancel,
  onFillFromConfig
}: {
  form: EditingTarget
  disabled: boolean
  preferAdvancedOpen: boolean
  configIdentityAlias: string | null
  onFormChange: (updater: (prev: EditingTarget) => EditingTarget) => void
  onSubmit: () => void
  onCancel: () => void
  onFillFromConfig: () => void
}): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {translate('auto.components.sidebar.AddRemoteHostDialog.sshTitle', 'Add SSH host')}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'auto.components.sidebar.AddRemoteHostDialog.sshDescription',
            'Add a persistent machine you can log into over SSH.'
          )}
        </DialogDescription>
      </DialogHeader>

      <SshHostFields
        form={form}
        disabled={disabled}
        preferAdvancedOpen={preferAdvancedOpen}
        configIdentityAlias={configIdentityAlias}
        onFormChange={onFormChange}
        onSubmit={onSubmit}
      />

      <DialogFooter className="sm:justify-between">
        <button
          type="button"
          className="self-center text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onFillFromConfig}
          disabled={disabled}
        >
          {translate(
            'auto.components.sidebar.AddRemoteHostDialog.fillFromSshConfig',
            'Fill from ~/.ssh/config…'
          )}
        </button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={disabled}>
            {translate('auto.components.sidebar.AddRemoteHostDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={disabled}>
            {disabled
              ? translate('auto.components.sidebar.AddRemoteHostDialog.saving', 'Saving...')
              : translate('auto.components.sidebar.AddRemoteHostDialog.save', 'Save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
