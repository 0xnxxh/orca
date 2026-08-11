import { useEffect, useMemo, useState } from 'react'
import { Loader2, Link2Off, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { OrcaOrgMember } from '../../../../shared/orca-profiles'
import type {
  SkillCloudOperation,
  SkillCloudPackageDetails
} from '../../../../shared/skill-cloud-contract'

type IdentifiedMember = OrcaOrgMember & { userId: string }
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
  const stateKey = JSON.stringify([
    props.details.id,
    management.userIds,
    management.shareWithOrganization,
    management.shares
  ])
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
  const [members, setMembers] = useState<IdentifiedMember[]>([])
  const [organizationAvailable, setOrganizationAvailable] = useState(false)
  const [userIds, setUserIds] = useState<string[]>(management?.userIds ?? [])
  const [shareWithOrganization, setShareWithOrganization] = useState(
    management?.shareWithOrganization ?? false
  )
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setOrganizationAvailable(false)
    setMembers([])
    void window.api.orcaProfiles
      .authStatus()
      .then(async (auth) => {
        const orgId = auth.cloud?.activeOrgId
        if (!active || !orgId) {
          return
        }
        setOrganizationAvailable(true)
        const result = await window.api.orcaProfiles.orgMembersList({ orgId })
        if (active && result.status === 'ok') {
          setMembers(
            result.roster.members.filter(
              (member): member is IdentifiedMember =>
                Boolean(member.userId) && member.userId !== auth.cloud?.userId
            )
          )
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const unknownUserCount = useMemo(
    () => userIds.filter((id) => !members.some((member) => member.userId === id)).length,
    [members, userIds]
  )

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
    <section className="space-y-4 border-t border-border pt-3" aria-label="Cloud sharing controls">
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Access</h4>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={shareWithOrganization}
            disabled={!organizationAvailable || busyAction !== null}
            onCheckedChange={(checked) => setShareWithOrganization(checked === true)}
          />
          Current organization
        </label>
        {members.length > 0 ? (
          <div className="max-h-28 space-y-1 overflow-y-auto scrollbar-sleek rounded-md border border-border p-2">
            {members.map((member) => (
              <label key={member.userId} className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={userIds.includes(member.userId)}
                  disabled={busyAction !== null}
                  onCheckedChange={(checked) =>
                    setUserIds((current) =>
                      checked
                        ? [...new Set([...current, member.userId])]
                        : current.filter((id) => id !== member.userId)
                    )
                  }
                />
                <span className="truncate">{member.displayName || member.email}</span>
              </label>
            ))}
          </div>
        ) : null}
        {unknownUserCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {unknownUserCount} existing recipient{unknownUserCount === 1 ? '' : 's'} outside the
            current roster will be preserved.
          </p>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busyAction !== null}
          onClick={() =>
            void run('access', () =>
              window.api.skills.replacePackageAccess({
                packageId: details.id,
                userIds,
                shareWithOrganization
              })
            )
          }
        >
          {busyAction === 'access' ? <Loader2 className="size-4 animate-spin" /> : <Save />}
          Save access
        </Button>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Active links</h4>
        <p className="text-xs text-muted-foreground">
          Unsharing blocks future installs. Copies already installed on any machine remain there.
        </p>
        {management.shares.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active share links.</p>
        ) : (
          management.shares.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-2 rounded-md border border-border p-2"
            >
              <Badge variant="outline" className="min-w-0 truncate font-mono">
                {share.id}
              </Badge>
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
                {confirmation === `share:${share.id}` ? 'Confirm unshare' : 'Unshare'}
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
            ? 'Confirm version deletion'
            : 'Delete selected Cloud version'}
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
          {confirmation === 'package' ? 'Confirm package deletion' : 'Delete Cloud package'}
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
