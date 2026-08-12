import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type {
  SkillSharePreview,
  SkillShareProgress
} from '../../../../shared/skill-sharing-contract'
import type { ManagedSkillInstall } from '../../../../shared/skill-install-contract'
import type { DiscoveredSkill } from '../../../../shared/skills'
import {
  SkillShareDialogHeader,
  SkillSharePreparationReview,
  SkillSharePublishedLink
} from './SkillShareReviewContent'
import { matchingManagedSkillShareInstall } from './skill-share-package-selection'

type SkillShareDialogProps = {
  skills?: DiscoveredSkill[]
  skill?: DiscoveredSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function operationError(status: string): string {
  return status === 'reconnect-required'
    ? translate(
        'auto.components.skills.SkillShareDialog.reconnect',
        'Reconnect your Orca account before sharing.'
      )
    : translate(
        'auto.components.skills.SkillShareDialog.unconfigured',
        'Connect an Orca Cloud account before sharing.'
      )
}

export function SkillShareDialog({
  skills,
  skill,
  open,
  onOpenChange
}: SkillShareDialogProps): React.JSX.Element {
  const selectedSkills = useMemo(() => skills ?? (skill ? [skill] : []), [skill, skills])
  const [preview, setPreview] = useState<SkillSharePreview | null>(null)
  const [author, setAuthor] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [progress, setProgress] = useState<SkillShareProgress | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [publishingNewVersion, setPublishingNewVersion] = useState(false)
  const generation = useRef(0)
  const cancellationRequested = useRef(false)

  useEffect(() => {
    if (!open || selectedSkills.length === 0) {
      return
    }
    const current = ++generation.current
    setPreview(null)
    setShareUrl(null)
    setProgress(null)
    setError(null)
    setPublishingNewVersion(false)
    setPreparing(true)
    void (async () => {
      let managedInstall: ManagedSkillInstall | null = null
      try {
        const operation = await window.api.skills.listManagedInstalls()
        if (operation.status === 'ok') {
          managedInstall = matchingManagedSkillShareInstall(selectedSkills, operation.value)
        }
      } catch (cause) {
        console.warn('[skills] managed install lookup failed during share:', cause)
      }
      const [nextPreview, auth] = await Promise.all([
        window.api.skills.prepareShare({
          skillIds: selectedSkills.map((skill) => skill.id),
          bundleName: selectedSkills.length === 1 ? selectedSkills[0].name : 'shared-skills',
          ...(managedInstall ? { packageId: managedInstall.packageId } : {})
        }),
        window.api.orcaProfiles.authStatus()
      ])
      return { nextPreview, auth, managedInstall }
    })()
      .then(async ({ nextPreview, auth, managedInstall }) => {
        if (generation.current !== current) {
          await window.api.skills.releaseShare(nextPreview.preparationId)
          return
        }
        setPreview(nextPreview)
        setPublishingNewVersion(managedInstall !== null)
        const cloud = auth.cloud
        setAuthor(cloud?.displayName || cloud?.email || '')
      })
      .catch((cause) => {
        console.warn('[skills] share preparation failed:', cause)
        if (generation.current === current) {
          setError(
            translate(
              'auto.components.skills.SkillShareDialog.prepareFailed',
              'Could not prepare this skill for sharing.'
            )
          )
        }
      })
      .finally(() => {
        if (generation.current === current) {
          setPreparing(false)
        }
      })
  }, [open, selectedSkills])

  useEffect(() => {
    if (!preview) {
      return
    }
    return window.api.skills.onShareProgress((next) => {
      if (next.preparationId === preview.preparationId) {
        setProgress(next)
      }
    })
  }, [preview])

  const progressPercent = useMemo(() => {
    if (!progress || progress.totalBytes === 0) {
      return 0
    }
    return Math.min(100, Math.round((progress.bytesSent / progress.totalBytes) * 100))
  }, [progress])

  const close = async (): Promise<void> => {
    generation.current += 1
    if (preview && !shareUrl) {
      await window.api.skills.releaseShare(preview.preparationId)
    }
    onOpenChange(false)
  }

  const publish = async (): Promise<void> => {
    if (!preview) {
      return
    }
    setPublishing(true)
    cancellationRequested.current = false
    setError(null)
    try {
      const result = await window.api.skills.publishShare({
        preparationId: preview.preparationId,
        releaseNotes
      })
      if (result.status !== 'ok') {
        setError(operationError(result.status))
        return
      }
      setShareUrl(result.value.share.url)
    } catch (cause) {
      console.warn('[skills] publish failed:', cause)
      setError(
        cancellationRequested.current
          ? translate(
              'auto.components.skills.SkillShareDialog.publishCancelled',
              'Upload cancelled. The prepared copy is still available to retry.'
            )
          : translate(
              'auto.components.skills.SkillShareDialog.publishFailed',
              'Could not publish this skill. The prepared copy is still available to retry.'
            )
      )
    } finally {
      cancellationRequested.current = false
      setCancelling(false)
      setPublishing(false)
    }
  }

  const cancelPublish = async (): Promise<void> => {
    if (!preview || cancelling) {
      return
    }
    cancellationRequested.current = true
    setCancelling(true)
    try {
      await window.api.skills.cancelShare(preview.preparationId)
    } catch {
      cancellationRequested.current = false
      setCancelling(false)
      setError('Orca could not send the cancellation request. The upload may still finish.')
    }
  }

  const copyLink = async (): Promise<void> => {
    if (!shareUrl) {
      return
    }
    await window.api.ui.writeClipboardText(shareUrl)
    toast.success(translate('auto.components.skills.SkillShareDialog.copied', 'Share link copied'))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !publishing && void close()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-xl">
        <SkillShareDialogHeader
          published={Boolean(shareUrl)}
          publishingNewVersion={publishingNewVersion}
          skillCount={selectedSkills.length}
        />

        {preparing ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate('auto.components.skills.SkillShareDialog.preparing', 'Preparing preview…')}
          </div>
        ) : preview && !shareUrl ? (
          <SkillSharePreparationReview
            preview={preview}
            author={author}
            releaseNotes={releaseNotes}
            onReleaseNotesChange={setReleaseNotes}
            publishing={publishing}
            progress={progress}
            progressPercent={progressPercent}
          />
        ) : shareUrl ? (
          <SkillSharePublishedLink shareUrl={shareUrl} onCopy={() => void copyLink()} />
        ) : null}

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => void close()} disabled={publishing}>
            {shareUrl
              ? translate('auto.components.skills.SkillShareDialog.3af85f6add', 'Done')
              : translate('auto.components.skills.SkillShareDialog.30985d4fc0', 'Cancel')}
          </Button>
          {!shareUrl ? (
            publishing ? (
              <Button
                type="button"
                variant="secondary"
                disabled={cancelling}
                onClick={() => void cancelPublish()}
              >
                {cancelling
                  ? translate('auto.components.skills.SkillShareDialog.e9d652ae3d', 'Cancelling…')
                  : translate(
                      'auto.components.skills.SkillShareDialog.3a51d0f34f',
                      'Cancel upload'
                    )}
              </Button>
            ) : (
              <Button type="button" disabled={!preview || preparing} onClick={() => void publish()}>
                <Share2 className="size-4" />
                {publishingNewVersion
                  ? translate(
                      'auto.components.skills.SkillShareDialog.7aa4ba0dba',
                      'Publish new version'
                    )
                  : selectedSkills.length > 1
                    ? translate(
                        'auto.components.skills.SkillShareDialog.publishBundle',
                        'Publish bundle'
                      )
                    : translate(
                        'auto.components.skills.SkillShareDialog.0f07fa2a79',
                        'Publish skill'
                      )}
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
