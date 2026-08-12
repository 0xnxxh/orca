import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import type {
  ManagedSkillInstall,
  SkillInstallResult
} from '../../../../shared/skill-install-contract'
import type { SkillBundleInstallResult } from '../../../../shared/skill-bundle-install-contract'
import type { SkillCloudPackageDetails } from '../../../../shared/skill-cloud-contract'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'
import { skillInstallResultLabel } from './skill-install-result-label'
import { skillInstallManagementCopy } from './skill-install-management-copy'
import { useSkillInstallProgress } from './skill-install-progress-state'
import { SkillManagedInstallList } from './SkillManagedInstallList'
import { SkillManagedInstallDetails } from './SkillManagedInstallDetails'
import {
  groupManagedSkillInstalls,
  type SkillManagedInstallGroup
} from './skill-managed-install-groups'

export function SkillInstallManagementDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const copy = skillInstallManagementCopy()
  const runtimeEnvironments = useAppStore((state) => state.runtimeEnvironments)
  const sshConnectionStates = useAppStore((state) => state.sshConnectionStates)
  const sshTargetLabels = useAppStore((state) => state.sshTargetLabels)
  const [environmentId, setEnvironmentId] = useState('local')
  const [installs, setInstalls] = useState<ManagedSkillInstall[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [details, setDetails] = useState<SkillCloudPackageDetails | null>(null)
  const [versionId, setVersionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [result, setResult] = useState<SkillInstallResult | null>(null)
  const [bundleResult, setBundleResult] = useState<SkillBundleInstallResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const installProgress = useSkillInstallProgress()

  const groups = useMemo(() => groupManagedSkillInstalls(installs), [installs])
  const selected = useMemo(
    () => groups.find((group) => group.key === selectedKey) ?? null,
    [groups, selectedKey]
  )
  const selectedInstall = selected?.installs[0] ?? null

  const load = useCallback(async (): Promise<void> => {
    if (!open) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const operation = await window.api.skills.listManagedInstalls(
        environmentId === 'local' ? undefined : environmentId
      )
      if (operation.status !== 'ok') {
        setError(operation.message)
        return
      }
      setInstalls(operation.value)
      setSelectedKey('')
      setDetails(null)
      setNotice(null)
    } catch (cause) {
      console.warn('[skills] managed install listing failed:', cause)
      setError('Orca could not inspect managed installs on this machine.')
    } finally {
      setBusy(false)
    }
  }, [environmentId, open])

  useEffect(() => {
    void load()
  }, [load])

  const selectInstall = async (group: SkillManagedInstallGroup): Promise<void> => {
    setSelectedKey(group.key)
    setBusy(true)
    setError(null)
    setNotice(null)
    setResult(null)
    setBundleResult(null)
    setConfirmRemove(false)
    try {
      const operation = await window.api.skills.getPackage(group.packageId)
      if (operation.status !== 'ok') {
        setError(
          operation.status === 'reconnect-required'
            ? 'Reconnect your Orca account to load version history.'
            : operation.message
        )
        return
      }
      setDetails(operation.value)
      setVersionId(operation.value.versions[0]?.versionId ?? group.versionId)
    } catch (cause) {
      console.warn('[skills] package history failed:', cause)
      setError('Version history is unavailable for this skill.')
    } finally {
      setBusy(false)
    }
  }

  const refreshPackageDetails = async (): Promise<void> => {
    if (!selected) {
      return
    }
    const operation = await window.api.skills.getPackage(selected.packageId)
    if (operation.status !== 'ok') {
      throw new Error(operation.status)
    }
    setDetails(operation.value)
    setVersionId((current) =>
      operation.value.versions.some((version) => version.versionId === current)
        ? current
        : (operation.value.versions[0]?.versionId ?? '')
    )
  }

  const packageDeleted = (): void => {
    setDetails(null)
    setVersionId('')
    setNotice('Cloud package deleted. The installed copy remains on this machine.')
  }

  const installVersion = async (discardLocal = false): Promise<void> => {
    if (!selected || !selectedInstall || !versionId) {
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    const operationId = crypto.randomUUID()
    installProgress.begin(operationId)
    try {
      const version = details?.versions.find((candidate) => candidate.versionId === versionId)
      const bundleManifest =
        version?.manifest && 'skills' in version.manifest ? version.manifest : null
      if (bundleManifest) {
        const installedNames = new Set(selected.installs.map((install) => install.name))
        const selectedSkills = bundleManifest.skills.filter((skill) =>
          installedNames.has(skill.name)
        )
        if (selectedSkills.length === 0) {
          setError('This version does not contain any of the installed bundle skills.')
          return
        }
        const operation = await window.api.skills.installBundlePackageVersion({
          packageId: selected.packageId,
          versionId,
          operationId,
          ...(environmentId === 'local' || environmentId.startsWith('ssh:')
            ? {}
            : { environmentId }),
          selectedSkillIds: selectedSkills.map((skill) => skill.id),
          destination: selected.destination,
          ...(discardLocal
            ? {
                conflictDecisions: selectedSkills.map((skill) => ({
                  skillId: skill.id,
                  resolution: 'replace-and-discard-local' as const
                }))
              }
            : {})
        })
        if (operation.status !== 'ok') {
          setError(
            operation.status === 'reconnect-required'
              ? 'Reconnect your Orca account before changing versions.'
              : operation.message
          )
          return
        }
        setBundleResult(operation.value)
        if (!['failed', 'cancelled'].includes(operation.value.status)) {
          notifyInstalledAgentSkillsChanged()
          if (operation.value.status === 'complete') {
            await load()
          }
        }
        return
      }
      const operation = await window.api.skills.installPackageVersion({
        packageId: selected.packageId,
        versionId,
        operationId,
        ...(environmentId === 'local' || environmentId.startsWith('ssh:') ? {} : { environmentId }),
        destination: selected.destination,
        ...(discardLocal ? { conflictResolution: 'replace-and-discard-local' } : {})
      })
      if (operation.status !== 'ok') {
        setError(
          operation.status === 'reconnect-required'
            ? 'Reconnect your Orca account before changing versions.'
            : operation.message
        )
        return
      }
      setResult(operation.value)
      if (!['conflict', 'failed', 'cancelled'].includes(operation.value.status)) {
        notifyInstalledAgentSkillsChanged()
        if (operation.value.status !== 'partial') {
          await load()
        }
      }
    } catch (cause) {
      console.warn('[skills] version installation failed:', cause)
      setError('Orca could not verify the requested version.')
    } finally {
      installProgress.finish()
      setBusy(false)
    }
  }

  const cancelInstall = async (): Promise<void> => {
    if (!installProgress.activeOperationId) {
      return
    }
    const cancelled = await window.api.skills.cancelInstall({
      operationId: installProgress.activeOperationId,
      ...(environmentId === 'local' || environmentId.startsWith('ssh:') ? {} : { environmentId })
    })
    if (!cancelled.cancelled) {
      setError('The destination had already finished this installation.')
    }
  }

  const remove = async (discardLocal = false): Promise<void> => {
    if (!selected) {
      return
    }
    if (!confirmRemove && !discardLocal) {
      setConfirmRemove(true)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const targets = discardLocal
        ? selected.installs.filter((install) => install.state === 'modified')
        : selected.installs
      const operations = await Promise.all(
        targets.map((install) =>
          window.api.skills.removeInstall({
            ...(environmentId === 'local' || environmentId.startsWith('ssh:')
              ? {}
              : { environmentId }),
            name: install.name,
            destination: install.destination,
            ...(discardLocal ? { conflictResolution: 'replace-and-discard-local' as const } : {})
          })
        )
      )
      const unsupported = operations.find((operation) => operation.status !== 'ok')
      if (unsupported?.status === 'unsupported') {
        setError(unsupported.message)
        return
      }
      const values = operations.flatMap((operation) =>
        operation.status === 'ok' ? [operation.value] : []
      )
      const removed = values.filter((value) => value.status === 'removed').length
      const preserved = values.filter((value) => value.status === 'conflict').length
      setResult(values.at(-1) ?? null)
      setNotice(
        selected.installs.length > 1
          ? `${removed} removed${preserved ? ` · ${preserved} modified skill${preserved === 1 ? '' : 's'} preserved` : ''}.`
          : null
      )
      if (removed > 0) {
        notifyInstalledAgentSkillsChanged()
      }
      if (preserved === 0 && values.every((value) => value.status !== 'failed')) {
        await load()
      }
    } catch (cause) {
      console.warn('[skills] managed removal failed:', cause)
      setError('Orca could not safely remove this skill.')
    } finally {
      setBusy(false)
    }
  }

  const close = (): void => {
    setSelectedKey('')
    setDetails(null)
    setError(null)
    setNotice(null)
    setResult(null)
    setBundleResult(null)
    setConfirmRemove(false)
    onOpenChange(false)
  }

  const destructiveConflict =
    result?.status === 'conflict' ||
    Boolean(selected?.installs.some((install) => install.state === 'modified'))

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <Select value={environmentId} onValueChange={setEnvironmentId}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">{copy.localMachine}</SelectItem>
            {runtimeEnvironments.map((environment) => (
              <SelectItem key={environment.id} value={environment.id}>
                {environment.name}
              </SelectItem>
            ))}
            {[...sshTargetLabels.entries()].map(([id, label]) => (
              <SelectItem
                key={`ssh:${id}`}
                value={`ssh:${id}`}
                disabled={sshConnectionStates.get(id)?.status !== 'connected'}
              >
                {label}{' '}
                {sshConnectionStates.get(id)?.status === 'connected' ? copy.ssh : copy.disconnected}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {busy && installs.length === 0 ? <Loader2 className="mx-auto size-5 animate-spin" /> : null}
        {!busy && installs.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            {copy.noInstalls}
          </p>
        ) : null}
        <SkillManagedInstallList
          groups={groups}
          selectedKey={selectedKey}
          onSelect={(group) => void selectInstall(group)}
        />

        {selected && details ? (
          <SkillManagedInstallDetails
            selected={selected}
            details={details}
            versionId={versionId}
            busy={busy}
            confirmRemove={confirmRemove}
            result={result}
            bundleResult={bundleResult}
            installActive={Boolean(installProgress.activeOperationId)}
            destructiveConflict={destructiveConflict}
            copy={copy}
            onVersionChange={setVersionId}
            onInstall={(discardLocal) => void installVersion(discardLocal)}
            onCancelInstall={() => void cancelInstall()}
            onRemove={(discardLocal) => void remove(discardLocal)}
            onCloudChanged={refreshPackageDetails}
            onPackageDeleted={packageDeleted}
          />
        ) : null}
        {result ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {skillInstallResultLabel(result)}
          </p>
        ) : null}
        {installProgress.phaseLabel ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {installProgress.phaseLabel}
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            {copy.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
