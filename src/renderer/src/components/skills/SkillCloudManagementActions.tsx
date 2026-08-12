import { useState } from 'react'
import { Clipboard, Link2Off, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  SkillCloudOperation,
  SkillCloudPackageDetails
} from '../../../../shared/skill-cloud-contract'
import { translate } from '@/i18n/i18n'

type SkillCloudManagement = NonNullable<SkillCloudPackageDetails['management']>
type SkillCloudManagementActionsProps = {
  details: SkillCloudPackageDetails
  selectedVersionId: string
  onChanged: () => Promise<void>
  onPackageDeleted: () => void
}

function operationMessage(operation: SkillCloudOperation<void>): string | null {
  if (operation.status === 'ok') {
    return null
  }
  return operation.status === 'reconnect-required'
    ? 'Reconnect your Orca account and try again.'
    : operation.message
}

export function SkillCloudManagementActions(
  props: SkillCloudManagementActionsProps
): React.JSX.Element | null {
  const management = props.details.management
  if (!props.details.canManage || !management) {
    return null
  }
  const stateKey = JSON.stringify([props.details.id, management.shares])
  return <SkillCloudManagementForm key={stateKey} {...props} management={management} />
}

function SkillCloudManagementForm({
  details,
  selectedVersionId,
  onChanged,
  onPackageDeleted,
  management
}: SkillCloudManagementActionsProps & {
  management: SkillCloudManagement
}): React.JSX.Element {
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const copyShareLink = async (url?: string): Promise<void> => {
    if (!url) {
      return
    }
    await window.api.ui.writeClipboardText(url)
    toast.success(
      translate(
        'auto.components.skills.SkillCloudManagementActions.linkCopied',
        'Share link copied'
      )
    )
  }

  const run = async (
    action: string,
    operation: () => Promise<SkillCloudOperation<void>>,
    after: () => Promise<void> | void = onChanged
  ): Promise<void> => {
    setBusyAction(action)
    setMessage(null)
    try {
      const result = await operation()
      const failure = operationMessage(result)
      if (failure) {
        setMessage(failure)
        return
      }
      setConfirmation(null)
      try {
        await after()
      } catch {
        setMessage('Cloud change completed, but Orca could not refresh package details.')
      }
    } catch {
      setMessage('Orca could not complete this Cloud change.')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section
      className="space-y-4 border-t border-border pt-3"
      aria-label={translate(
        'auto.components.skills.SkillCloudManagementActions.505cd6105c',
        'Cloud sharing controls'
      )}
    >
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">
          {translate(
            'auto.components.skills.SkillCloudManagementActions.8cac3b9362',
            'Active links'
          )}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.skills.SkillCloudManagementActions.activeLinkBearerDescription',
            'Anyone with an active link can inspect and install the skills. Revoking blocks future access but leaves installed copies unchanged.'
          )}
        </p>
        {management.shares.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.skills.SkillCloudManagementActions.9e6bd31487',
              'No active share links.'
            )}
          </p>
        ) : (
          management.shares.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-2 rounded-md border border-border p-2"
            >
              <Badge variant="outline" className="min-w-0 truncate font-mono">
                {share.url ?? share.id}
              </Badge>
              {share.url ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyAction !== null}
                  onClick={() => void copyShareLink(share.url)}
                >
                  <Clipboard className="size-4" />
                  {translate(
                    'auto.components.skills.SkillCloudManagementActions.copyLink',
                    'Copy link'
                  )}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={confirmation === `share:${share.id}` ? 'destructive' : 'outline'}
                disabled={busyAction !== null}
                onClick={() => {
                  if (confirmation !== `share:${share.id}`) {
                    setConfirmation(`share:${share.id}`)
                    return
                  }
                  void run(`share:${share.id}`, () => window.api.skills.revokeShare(share.id))
                }}
              >
                <Link2Off className="size-4" />
                {confirmation === `share:${share.id}`
                  ? translate(
                      'auto.components.skills.SkillCloudManagementActions.0ac5c175fd',
                      'Confirm unshare'
                    )
                  : translate(
                      'auto.components.skills.SkillCloudManagementActions.7a80285dad',
                      'Unshare'
                    )}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={confirmation === `version:${selectedVersionId}` ? 'destructive' : 'outline'}
          disabled={!selectedVersionId || busyAction !== null}
          onClick={() => {
            if (confirmation !== `version:${selectedVersionId}`) {
              setConfirmation(`version:${selectedVersionId}`)
              return
            }
            void run(`version:${selectedVersionId}`, () =>
              window.api.skills.deletePackageVersion({
                packageId: details.id,
                versionId: selectedVersionId
              })
            )
          }}
        >
          <Trash2 className="size-4" />
          {confirmation === `version:${selectedVersionId}`
            ? translate(
                'auto.components.skills.SkillCloudManagementActions.bbec37d8f8',
                'Confirm version deletion'
              )
            : translate(
                'auto.components.skills.SkillCloudManagementActions.6b6adf68c1',
                'Delete selected Cloud version'
              )}
        </Button>
        <Button
          size="sm"
          variant={confirmation === 'package' ? 'destructive' : 'outline'}
          disabled={busyAction !== null}
          onClick={() => {
            if (confirmation !== 'package') {
              setConfirmation('package')
              return
            }
            void run('package', () => window.api.skills.deletePackage(details.id), onPackageDeleted)
          }}
        >
          <Trash2 className="size-4" />
          {confirmation === 'package'
            ? translate(
                'auto.components.skills.SkillCloudManagementActions.640bc6b92e',
                'Confirm package deletion'
              )
            : translate(
                'auto.components.skills.SkillCloudManagementActions.ed753624c0',
                'Delete Cloud package'
              )}
        </Button>
      </div>
      {message ? (
        <p className="text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  )
}
