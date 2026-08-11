import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import type { SkillCloudPackageDetails } from '../../../../shared/skill-cloud-contract'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'
import { SkillCloudManagementActions } from './SkillCloudManagementActions'
import { skillInstallResultLabel } from './skill-install-result-label'

function installKey(install: ManagedSkillInstall): string {
  return `${install.destinationIdentity}:${install.name}:${install.packageId}`
}

export function SkillInstallManagementDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
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
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null)

  const selected = useMemo(
    () => installs.find((install) => installKey(install) === selectedKey) ?? null,
    [installs, selectedKey]
  )

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

  const selectInstall = async (install: ManagedSkillInstall): Promise<void> => {
    setSelectedKey(installKey(install))
    setBusy(true)
    setError(null)
    setNotice(null)
    setResult(null)
    setConfirmRemove(false)
    try {
      const operation = await window.api.skills.getPackage(install.packageId)
      if (operation.status !== 'ok') {
        setError(
          operation.status === 'reconnect-required'
            ? 'Reconnect your Orca account to load version history.'
            : operation.message
        )
        return
      }
      setDetails(operation.value)
      setVersionId(operation.value.versions[0]?.versionId ?? install.versionId)
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
    if (!selected || !versionId) {
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    const operationId = crypto.randomUUID()
    setActiveOperationId(operationId)
    try {
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
        await load()
      }
    } catch (cause) {
      console.warn('[skills] version installation failed:', cause)
      setError('Orca could not verify the requested version.')
    } finally {
      setActiveOperationId(null)
      setBusy(false)
    }
  }

  const cancelInstall = async (): Promise<void> => {
    if (!activeOperationId) {
      return
    }
    const cancelled = await window.api.skills.cancelInstall({
      operationId: activeOperationId,
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
      const operation = await window.api.skills.removeInstall({
        ...(environmentId === 'local' || environmentId.startsWith('ssh:') ? {} : { environmentId }),
        name: selected.name,
        destination: selected.destination,
        ...(discardLocal ? { conflictResolution: 'replace-and-discard-local' } : {})
      })
      if (operation.status !== 'ok') {
        setError(operation.message)
        return
      }
      setResult(operation.value)
      if (!['conflict', 'failed', 'cancelled'].includes(operation.value.status)) {
        notifyInstalledAgentSkillsChanged()
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
    setConfirmRemove(false)
    onOpenChange(false)
  }

  const destructiveConflict = result?.status === 'conflict' || selected?.state === 'modified'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage installed skills</DialogTitle>
          <DialogDescription>
            Update, roll back, or safely remove versions installed by Orca.
          </DialogDescription>
        </DialogHeader>
        <Select value={environmentId} onValueChange={setEnvironmentId}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">This computer</SelectItem>
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
                {label}
                {sshConnectionStates.get(id)?.status === 'connected' ? ' · SSH' : ' — disconnected'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {busy && installs.length === 0 ? <Loader2 className="mx-auto size-5 animate-spin" /> : null}
        {!busy && installs.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No Orca-managed skill installs were found on this machine.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {installs.map((install) => (
            <Button
              key={installKey(install)}
              type="button"
              variant={selectedKey === installKey(install) ? 'secondary' : 'outline'}
              className="h-auto justify-start p-3 text-left"
              onClick={() => void selectInstall(install)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{install.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {install.scope} · {install.versionId}
                </span>
              </span>
              <Badge
                variant={install.state === 'unchanged' ? 'outline' : 'destructive'}
                className="ml-auto"
              >
                {install.state}
              </Badge>
            </Button>
          ))}
        </div>

        {selected && details ? (
          <section className="space-y-3 rounded-md border border-border p-3">
            <div>
              <h3 className="text-sm font-semibold">{selected.name}</h3>
              <p className="text-xs text-muted-foreground">
                Installed version {selected.versionId}
              </p>
            </div>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a version" />
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
                  <AlertTriangle className="size-4" /> Local files were modified
                </p>
                <p className="text-xs text-muted-foreground">
                  Orca will preserve them unless you explicitly discard the local changes.
                </p>
                <Button variant="destructive" size="sm" onClick={() => void installVersion(true)}>
                  Discard changes and install version
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void remove(true)}>
                  Discard changes and remove
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || versionId === selected.versionId}
                onClick={() => void installVersion()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Install selected version
              </Button>
              {activeOperationId ? (
                <Button variant="secondary" size="sm" onClick={() => void cancelInstall()}>
                  Cancel installation
                </Button>
              ) : null}
              <Button
                variant={confirmRemove ? 'destructive' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 className="size-4" /> {confirmRemove ? 'Confirm remove' : 'Remove'}
              </Button>
            </div>
            <SkillCloudManagementActions
              details={details}
              selectedVersionId={versionId}
              onChanged={refreshPackageDetails}
              onPackageDeleted={packageDeleted}
            />
          </section>
        ) : null}
        {result ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {skillInstallResultLabel(result)}
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
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
