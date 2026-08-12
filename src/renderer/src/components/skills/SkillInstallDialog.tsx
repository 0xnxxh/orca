import { useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import type {
  SkillInstallDestination,
  SkillInstallPreview,
  SkillInstallResult
} from '../../../../shared/skill-install-contract'
import { parseSkillShareId } from './skill-share-link'
import { skillInstallWorkspaceChoices } from './skill-install-workspace-choices'
import { isSkillBundleVersion, type ResolvedSkillShare } from './skill-share-version-summary'
import { SkillBundleInstallFlow } from './SkillBundleInstallFlow'
import { SkillInstallTargetFields } from './SkillInstallTargetFields'
import {
  SkillInstallOutcome,
  SkillInstallReview,
  SkillShareLinkInputForm
} from './SkillInstallReviewContent'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'
import { useSkillInstallProgress } from './skill-install-progress-state'
import { translate } from '@/i18n/i18n'

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
  const [bundleBusy, setBundleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SkillInstallResult | null>(null)
  const [destinationPreview, setDestinationPreview] = useState<SkillInstallPreview | null>(null)
  const installProgress = useSkillInstallProgress()

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
          operation.status === 'unconfigured'
            ? operation.message
            : 'This share is unavailable. The link may be invalid, expired, or revoked.'
        )
        return
      }
      setPreview({ shareId, version: operation.value.version })
    } catch (cause) {
      console.warn('[skills] share resolution failed:', cause)
      setError('This share is unavailable. The link may be invalid, expired, or revoked.')
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
      const operationId = crypto.randomUUID()
      installProgress.begin(operationId)
      const operation = await window.api.skills.installShare({
        shareId: preview.shareId,
        operationId,
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
      if (!['conflict', 'failed', 'cancelled'].includes(operation.value.status)) {
        notifyInstalledAgentSkillsChanged()
      }
    } catch (cause) {
      console.warn('[skills] install failed:', cause)
      setError('Installation failed before Orca could verify the requested version.')
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

  const close = (): void => {
    setPreview(null)
    setDestinationPreview(null)
    setError(null)
    setLink('')
    setScope('global')
    setWorkspace('')
    setExecutionTarget(null)
    setBundleBusy(false)
    onOpenChange(false)
  }

  const bundleVersion = preview && isSkillBundleVersion(preview.version) ? preview.version : null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && !bundleBusy && close()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {bundleVersion
              ? translate(
                  'auto.components.skills.SkillInstallDialog.01c5a14e01',
                  'Install shared skills'
                )
              : translate(
                  'auto.components.skills.SkillInstallDialog.fcbec627cc',
                  'Install shared skill'
                )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.skills.SkillInstallDialog.4a00d133c5',
              'Orca verifies access and package identity before changing the selected machine.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <SkillShareLinkInputForm
            link={link}
            busy={busy}
            onLinkChange={setLink}
            onSubmit={() => void inspect()}
          />
        ) : bundleVersion ? (
          <SkillBundleInstallFlow
            shareId={preview.shareId}
            version={bundleVersion}
            onClose={close}
            onBusyChange={setBundleBusy}
          />
        ) : result && result.status !== 'conflict' ? (
          <SkillInstallOutcome result={result} />
        ) : (
          <SkillInstallReview
            preview={preview}
            destinationPreview={destinationPreview}
            result={result}
            busy={busy}
            onDiscard={() => void install(true)}
          >
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
          </SkillInstallReview>
        )}

        {!bundleVersion && error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!bundleVersion && installProgress.phaseLabel ? (
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {installProgress.phaseLabel}
          </p>
        ) : null}
        {!bundleVersion ? (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              {translate('auto.components.skills.SkillInstallDialog.d198ec91e5', 'Close')}
            </Button>
            {busy && installProgress.activeOperationId ? (
              <Button type="button" variant="secondary" onClick={() => void cancelInstall()}>
                {translate(
                  'auto.components.skills.SkillInstallDialog.05588076a9',
                  'Cancel installation'
                )}
              </Button>
            ) : null}
            {preview &&
            (!result || ['conflict', 'partial', 'failed', 'cancelled'].includes(result.status)) ? (
              <Button
                type="button"
                disabled={busy || (scope === 'workspace' && !workspace)}
                onClick={() => void install()}
                className="w-32"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {busy
                  ? translate('auto.components.skills.SkillInstallDialog.241e72f9d6', 'Installing…')
                  : result
                    ? translate(
                        'auto.components.skills.SkillInstallDialog.59c3b76cdd',
                        'Retry install'
                      )
                    : translate(
                        'auto.components.skills.SkillInstallDialog.39acb9e8f4',
                        'Install skill'
                      )}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
