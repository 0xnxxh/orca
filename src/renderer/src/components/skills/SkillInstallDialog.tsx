import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Download, Loader2, ShieldCheck } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/store'
import type {
  SkillInstallDestination,
  SkillInstallPreview,
  SkillInstallResult
} from '../../../../shared/skill-install-contract'
import { parseSkillShareId } from './skill-share-link'
import { skillInstallResultLabel } from './skill-install-result-label'
import { skillInstallWorkspaceChoices } from './skill-install-workspace-choices'
import { summarizeSkillShareVersion, type ResolvedSkillShare } from './skill-share-version-summary'
import { SkillInstallTargetFields } from './SkillInstallTargetFields'

export function SkillInstallDialog({
  open,
  onOpenChange,
  initialLink = ''
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialLink?: string
}): React.JSX.Element {
  const runtimeEnvironments = useAppStore((state) => state.runtimeEnvironments)
  const runtimeStatus = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const repos = useAppStore((state) => state.repos)
  const folderWorkspaces = useAppStore((state) => state.folderWorkspaces)
  const sshConnectionStates = useAppStore((state) => state.sshConnectionStates)
  const sshTargetLabels = useAppStore((state) => state.sshTargetLabels)
  const [link, setLink] = useState(initialLink)
  const [preview, setPreview] = useState<ResolvedSkillShare | null>(null)
  const [environmentId, setEnvironmentId] = useState<string>('local')
  const [scope, setScope] = useState<'global' | 'workspace'>('global')
  const [workspace, setWorkspace] = useState<string>('')
  const [executionTarget, setExecutionTarget] = useState<{ kind: 'wsl'; distro: string } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SkillInstallResult | null>(null)
  const [destinationPreview, setDestinationPreview] = useState<SkillInstallPreview | null>(null)

  const workspaceChoices = useMemo(
    () => skillInstallWorkspaceChoices({ environmentId, folderWorkspaces, repos, worktreesByRepo }),
    [environmentId, folderWorkspaces, repos, worktreesByRepo]
  )
  const sshConnections = useMemo(
    () =>
      [...sshTargetLabels.entries()].map(([id, label]) => ({
        id,
        label,
        connected: sshConnectionStates.get(id)?.status === 'connected'
      })),
    [sshConnectionStates, sshTargetLabels]
  )

  const inspect = async (): Promise<void> => {
    const shareId = parseSkillShareId(link)
    if (!shareId) {
      setError('Enter an Orca skill share link.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const operation = await window.api.skills.resolveShare(shareId)
      if (operation.status !== 'ok') {
        setError(
          operation.status === 'reconnect-required'
            ? 'Reconnect your Orca account to inspect this skill.'
            : operation.message
        )
        return
      }
      setPreview({ shareId, version: operation.value.version })
    } catch (cause) {
      console.warn('[skills] share resolution failed:', cause)
      setError('This share is unavailable or your account does not have access.')
    } finally {
      setBusy(false)
    }
  }

  const install = async (discardLocal = false): Promise<void> => {
    if (!preview) {
      return
    }
    const choice = workspaceChoices.find((candidate) => candidate.id === workspace)
    if (scope === 'workspace' && !choice) {
      setError('Choose a workspace.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const destination: SkillInstallDestination =
        scope === 'global'
          ? environmentId.startsWith('ssh:')
            ? {
                scope: 'global',
                executionTarget: {
                  kind: 'ssh',
                  connectionId: environmentId.slice('ssh:'.length)
                }
              }
            : { scope: 'global', ...(executionTarget ? { executionTarget } : {}) }
          : choice?.kind === 'worktree'
            ? { scope: 'workspace', worktreeId: choice.id }
            : { scope: 'workspace', folderWorkspaceId: choice!.id }
      if (!discardLocal) {
        const checked = await window.api.skills.previewInstall({
          ...(environmentId === 'local' || environmentId.startsWith('ssh:')
            ? {}
            : { environmentId }),
          name: preview.version.name,
          package: {
            packageId: preview.version.packageId,
            versionId: preview.version.versionId,
            packageDigest: preview.version.packageDigest,
            archiveSha256: preview.version.archiveSha256,
            compressedBytes: preview.version.compressedBytes
          },
          destination
        })
        if (checked.status === 'unsupported') {
          setError(checked.message)
          return
        }
        setDestinationPreview(checked.value)
        if (
          ['modified', 'unowned', 'external-link', 'name-collision'].includes(
            checked.value.currentState
          )
        ) {
          return
        }
      }
      const operation = await window.api.skills.installShare({
        shareId: preview.shareId,
        ...(environmentId === 'local' || environmentId.startsWith('ssh:') ? {} : { environmentId }),
        destination,
        ...(discardLocal ? { conflictResolution: 'replace-and-discard-local' } : {})
      })
      if (operation.status === 'unsupported') {
        setError(operation.message)
        return
      }
      if (operation.status !== 'ok') {
        setError(
          operation.status === 'reconnect-required'
            ? 'Reconnect your Orca account before installing.'
            : operation.message
        )
        return
      }
      setResult(operation.value)
    } catch (cause) {
      console.warn('[skills] install failed:', cause)
      setError('Installation failed before Orca could verify the requested version.')
    } finally {
      setBusy(false)
    }
  }

  const close = (): void => {
    setPreview(null)
    setDestinationPreview(null)
    setError(null)
    setLink('')
    setScope('global')
    setWorkspace('')
    setExecutionTarget(null)
    onOpenChange(false)
  }

  const version = preview?.version
  const versionSummary = summarizeSkillShareVersion(version)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Install shared skill</DialogTitle>
          <DialogDescription>
            Orca verifies access and package identity before changing the selected machine.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void inspect()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="skill-share-link">Orca skill link</Label>
              <Input
                id="skill-share-link"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://app.orca.dev/skills/share/…"
                className="font-mono text-xs"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Opening the link does not install anything. Review the immutable version first.
              </p>
            </div>
            <Button type="submit" disabled={busy || !link.trim()} className="w-32">
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {busy ? 'Checking…' : 'Inspect skill'}
            </Button>
          </form>
        ) : result && result.status !== 'conflict' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Check className="size-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{skillInstallResultLabel(result)}</p>
                <p className="text-xs text-muted-foreground">
                  {result.placements.length} placement{result.placements.length === 1 ? '' : 's'}{' '}
                  checked.
                </p>
              </div>
            </div>
            {result.status === 'partial' ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                {result.placements
                  .filter((item) => item.status === 'failed' || item.status === 'skipped')
                  .map((item) => (
                    <p key={`${item.provider}:${item.path}`}>
                      {item.provider}: {item.errorCategory || item.status}
                    </p>
                  ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{version?.name}</h3>
                  <p className="text-xs leading-5 text-muted-foreground">{version?.description}</p>
                </div>
                <Badge variant="outline">Immutable version</Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline">{version?.manifest.files.length} files</Badge>
                <Badge variant="outline">{versionSummary.scriptCount} scripts</Badge>
                <Badge variant="outline">{versionSummary.executableCount} executable</Badge>
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                SHA-256 {version?.packageDigest}
              </p>
              {version?.publisher ? (
                <p className="text-xs text-muted-foreground">
                  Published by Orca user {version.publisher.userId}
                  {version.publisher.organizationId
                    ? ` in organization ${version.publisher.organizationId}`
                    : ''}
                  .
                </p>
              ) : null}
              <p className="text-xs leading-5 text-muted-foreground">
                A skill contains instructions and may include scripts. Treat it as code from its
                author.
              </p>
            </section>

            <SkillInstallTargetFields
              environmentId={environmentId}
              onEnvironmentChange={(value) => {
                setEnvironmentId(value)
                setDestinationPreview(null)
              }}
              scope={scope}
              onScopeChange={(value) => {
                setScope(value)
                setDestinationPreview(null)
              }}
              workspace={workspace}
              onWorkspaceChange={(value) => {
                setWorkspace(value)
                setDestinationPreview(null)
              }}
              executionTarget={executionTarget}
              onExecutionTargetChange={(value) => {
                setExecutionTarget(value)
                setDestinationPreview(null)
              }}
              runtimeEnvironments={runtimeEnvironments}
              runtimeStatus={runtimeStatus}
              sshConnections={sshConnections}
              workspaceChoices={workspaceChoices}
            />

            {result?.status === 'conflict' ||
            (destinationPreview &&
              ['modified', 'unowned', 'external-link', 'name-collision'].includes(
                destinationPreview.currentState
              )) ? (
              <section className="space-y-2 rounded-md border border-border p-3" role="alert">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="size-4" /> Local copy needs a decision
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Orca found{' '}
                  {result?.conflict?.kind || destinationPreview?.currentState || 'changed'} content
                  and left it untouched. Keep it, or explicitly discard and replace it with this
                  version.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void install(true)}
                >
                  Discard and replace
                </Button>
              </section>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Close
          </Button>
          {preview && (!result || result.status === 'conflict') ? (
            <Button
              type="button"
              disabled={busy || (scope === 'workspace' && !workspace)}
              onClick={() => void install()}
              className="w-32"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {busy ? 'Installing…' : 'Install skill'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
