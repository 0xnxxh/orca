import { AlertTriangle, Loader2, MonitorUp, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SkillBundleInstallResult } from '../../../../shared/skill-bundle-install-contract'
import type { SkillInstallResult } from '../../../../shared/skill-install-contract'
import type { SkillCloudPackageDetails } from '../../../../shared/skill-cloud-contract'
import { SkillCloudManagementActions } from './SkillCloudManagementActions'
import type { SkillManagedInstallGroup } from './skill-managed-install-groups'
import type { skillInstallManagementCopy } from './skill-install-management-copy'

type Copy = ReturnType<typeof skillInstallManagementCopy>

export function SkillManagedInstallDetails({
  selected,
  details,
  versionId,
  busy,
  confirmRemove,
  result,
  bundleResult,
  installActive,
  destructiveConflict,
  copy,
  onVersionChange,
  onInstall,
  onCancelInstall,
  onInstallAnotherMachine,
  onRemove,
  onCloudChanged,
  onPackageDeleted
}: {
  selected: SkillManagedInstallGroup
  details: SkillCloudPackageDetails
  versionId: string
  busy: boolean
  confirmRemove: boolean
  result: SkillInstallResult | null
  bundleResult: SkillBundleInstallResult | null
  installActive: boolean
  destructiveConflict: boolean
  copy: Copy
  onVersionChange: (versionId: string) => void
  onInstall: (discardLocal?: boolean) => void
  onCancelInstall: () => void
  onInstallAnotherMachine: (shareId: string) => void
  onRemove: (discardLocal?: boolean) => void
  onCloudChanged: () => Promise<void>
  onPackageDeleted: () => void
}): React.JSX.Element {
  const selectedVersion = details.versions.find((version) => version.versionId === versionId)
  const bundleManifest =
    selectedVersion?.manifest && 'skills' in selectedVersion.manifest
      ? selectedVersion.manifest
      : null
  const activeShare = details.management?.shares[0]
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <div>
        <h3 className="text-sm font-semibold">
          {bundleManifest?.bundleName ?? selected.installs[0]?.name}
        </h3>
        <p className="text-xs text-muted-foreground">
          {copy.installedVersion} {selected.versionId}
        </p>
        {selected.bundleDigest ? (
          <div className="mt-2 space-y-1" aria-label={copy.installedBundleSkills}>
            {selected.installs.map((install) => (
              <p key={install.name} className="flex justify-between gap-3 text-xs">
                <span className="truncate">{install.name}</span>
                <span className="text-muted-foreground">{install.state}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <Select value={versionId} onValueChange={onVersionChange}>
        <SelectTrigger>
          <SelectValue placeholder={copy.chooseVersion} />
        </SelectTrigger>
        <SelectContent>
          {details.versions.map((version) => (
            <SelectItem key={version.versionId} value={version.versionId}>
              {version.versionId} · {new Date(version.createdAt).toLocaleDateString()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {destructiveConflict ? (
        <div className="space-y-2 rounded-md border border-border p-3" role="alert">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" /> {copy.modified}
          </p>
          <p className="text-xs text-muted-foreground">{copy.preserveModified}</p>
          <Button variant="destructive" size="sm" onClick={() => onInstall(true)}>
            {copy.discardAndInstall}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onRemove(true)}>
            {copy.discardAndRemove}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={
            busy ||
            (versionId === selected.versionId &&
              result?.status !== 'partial' &&
              bundleResult?.status !== 'partial')
          }
          onClick={() => onInstall()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          {result?.status === 'partial' || bundleResult?.status === 'partial'
            ? copy.retryCoverage
            : selected.bundleDigest
              ? copy.installSkills(selected.installs.length)
              : copy.installVersion}
        </Button>
        {installActive ? (
          <Button variant="secondary" size="sm" onClick={onCancelInstall}>
            {copy.cancelInstall}
          </Button>
        ) : null}
        {activeShare ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onInstallAnotherMachine(activeShare.id)}
          >
            <MonitorUp className="size-4" /> {copy.installAnotherMachine}
          </Button>
        ) : null}
        <Button
          variant={confirmRemove ? 'destructive' : 'outline'}
          size="sm"
          disabled={busy}
          onClick={() => onRemove()}
        >
          <Trash2 className="size-4" />{' '}
          {confirmRemove
            ? selected.bundleDigest
              ? copy.confirmRemoveSkills(selected.installs.length)
              : copy.confirmRemove
            : selected.bundleDigest
              ? copy.removeSkills(selected.installs.length)
              : copy.remove}
        </Button>
      </div>
      <SkillCloudManagementActions
        details={details}
        selectedVersionId={versionId}
        onChanged={onCloudChanged}
        onPackageDeleted={onPackageDeleted}
      />
      {bundleResult ? (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {copy.bundleResult(
            bundleResult.skills.filter((skill) => skill.status === 'installed').length,
            bundleResult.skills.filter((skill) => skill.status === 'updated').length,
            bundleResult.skills.filter((skill) => skill.status === 'kept-local').length
          )}
        </p>
      ) : null}
    </section>
  )
}
