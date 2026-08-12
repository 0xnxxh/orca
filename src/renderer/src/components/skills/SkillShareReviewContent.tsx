import { Check, Clipboard, FileCode2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { translate } from '@/i18n/i18n'
import type {
  SkillSharePreview,
  SkillShareProgress
} from '../../../../shared/skill-sharing-contract'

export function SkillShareDialogHeader({
  published,
  publishingNewVersion,
  skillCount
}: {
  published: boolean
  publishingNewVersion: boolean
  skillCount: number
}): React.JSX.Element {
  const bundle = skillCount > 1
  return (
    <DialogHeader>
      <DialogTitle>
        {published
          ? bundle
            ? translate(
                'auto.components.skills.SkillShareReviewContent.bundleReady',
                'Skill bundle link ready'
              )
            : translate('auto.components.skills.SkillShareDialog.ready', 'Skill link ready')
          : publishingNewVersion
            ? bundle
              ? translate(
                  'auto.components.skills.SkillShareReviewContent.publishBundleVersion',
                  'Publish new skill bundle version'
                )
              : translate(
                  'auto.components.skills.SkillShareReviewContent.2dca0b720b',
                  'Publish new skill version'
                )
            : bundle
              ? translate(
                  'auto.components.skills.SkillShareReviewContent.shareBundle',
                  'Share skill bundle'
                )
              : translate('auto.components.skills.SkillShareDialog.title', 'Share skill')}
      </DialogTitle>
      <DialogDescription>
        {published
          ? translate(
              'auto.components.skills.SkillShareDialog.readyDescriptionV2',
              'Anyone with this unlisted link can inspect and install the skills.'
            )
          : publishingNewVersion
            ? translate(
                'auto.components.skills.SkillShareDialog.newVersionDescription',
                'Review the exact files, then publish an immutable version to the existing Cloud package.'
              )
            : translate(
                'auto.components.skills.SkillShareDialog.descriptionV2',
                'Review the exact files, then publish an immutable version behind an unlisted link.'
              )}
      </DialogDescription>
    </DialogHeader>
  )
}

function byteLabel(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function publishingPhaseLabel(progress: SkillShareProgress | null): string {
  if (progress?.phase === 'publishing') {
    return translate(
      'auto.components.skills.SkillShareReviewContent.publishingLink',
      'Publishing link…'
    )
  }
  if (progress?.phase === 'finalizing') {
    return translate(
      'auto.components.skills.SkillShareReviewContent.verifyingPackage',
      'Verifying package…'
    )
  }
  return translate('auto.components.skills.SkillShareReviewContent.0142581727', 'Uploading…')
}

export function SkillSharePreparationReview({
  preview,
  author,
  releaseNotes,
  onReleaseNotesChange,
  publishing,
  progress,
  progressPercent
}: {
  preview: SkillSharePreview
  author: string
  releaseNotes: string
  onReleaseNotesChange: (notes: string) => void
  publishing: boolean
  progress: SkillShareProgress | null
  progressPercent: number
}): React.JSX.Element {
  const skillPreviews = preview.skills ?? []
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <FileCode2 className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{preview.name}</h3>
            <p className="text-xs leading-5 text-muted-foreground">{preview.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline">
            {translate(
              'auto.components.skills.SkillShareReviewContent.01c5a17e01',
              '{{value0}} skills',
              { value0: preview.skillCount ?? preview.skills?.length ?? 1 }
            )}
          </Badge>
          <Badge variant="outline">
            {preview.fileCount}{' '}
            {translate('auto.components.skills.SkillShareReviewContent.3121f44358', 'files')}
          </Badge>
          <Badge variant="outline">{byteLabel(preview.totalBytes)}</Badge>
          <Badge variant="outline">
            {preview.scriptPaths.length}{' '}
            {translate('auto.components.skills.SkillShareReviewContent.8edd32622f', 'scripts')}
          </Badge>
          <Badge variant="outline">
            {preview.executablePaths.length}{' '}
            {translate('auto.components.skills.SkillShareReviewContent.77f636eac3', 'executable')}
          </Badge>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {translate('auto.components.skills.SkillShareReviewContent.b3b1d4b911', 'SHA-256')}{' '}
          {preview.packageDigest}
        </p>
        {skillPreviews.length > 1 ? (
          <details className="rounded-md border border-border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">
              {translate(
                'auto.components.skills.SkillShareReviewContent.01c5a17e02',
                'Review included skills'
              )}
            </summary>
            <div className="mt-2 space-y-2">
              {skillPreviews.map((skill) => (
                <div key={skill.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{skill.name}</p>
                    <p className="truncate text-muted-foreground">{skill.description}</p>
                  </div>
                  <span className="shrink-0 text-muted-foreground">
                    {translate(
                      'auto.components.skills.SkillShareReviewContent.01c5a17e03',
                      '{{value0}} files · {{value1}}',
                      { value0: skill.fileCount, value1: byteLabel(skill.totalBytes) }
                    )}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="space-y-2">
        <div className="space-y-1">
          <Label>
            {translate(
              'auto.components.skills.SkillShareReviewContent.unlistedLinkTitle',
              'Unlisted link'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {author
              ? translate(
                  'auto.components.skills.SkillShareReviewContent.unlistedPublishingAs',
                  'Publishing as {{value0}}. Anyone with the link can inspect and install these skills.',
                  { value0: author }
                )
              : translate(
                  'auto.components.skills.SkillShareReviewContent.c15d90c10b',
                  'A connected Orca Cloud account is required.'
                )}
          </p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.skills.SkillShareReviewContent.unlistedLinkDetails',
            'The link is not searchable or listed publicly. Revoke it to block future access; installed copies remain.'
          )}
        </p>
      </section>

      <section className="space-y-2">
        <Label htmlFor="skill-release-notes">
          {translate('auto.components.skills.SkillShareReviewContent.f0c0411549', 'Release notes')}
        </Label>
        <textarea
          id="skill-release-notes"
          value={releaseNotes}
          onChange={(event) => onReleaseNotesChange(event.target.value)}
          maxLength={10_000}
          placeholder={translate(
            'auto.components.skills.SkillShareReviewContent.bf02d6ed9e',
            'What changed in this version?'
          )}
          className="min-h-20 w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </section>

      {publishing ? (
        <section className="space-y-2" aria-live="polite">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{publishingPhaseLabel(progress)}</span>
            <span>{progress?.phase === 'uploading' ? `${progressPercent}%` : '100%'}</span>
          </div>
          <Progress value={progress?.phase === 'uploading' ? progressPercent : 100} />
        </section>
      ) : null}
    </div>
  )
}

export function SkillSharePublishedLink({
  shareUrl,
  onCopy
}: {
  shareUrl: string
  onCopy: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border border-border p-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Check className="size-4" />
        </div>
        <p className="min-w-0 flex-1 truncate font-mono text-xs">{shareUrl}</p>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          <Clipboard className="size-4" />{' '}
          {translate('auto.components.skills.SkillShareReviewContent.6d6233a3a4', 'Copy link')}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {translate(
          'auto.components.skills.SkillShareReviewContent.e3caf6baeb',
          'Revoking this link blocks future access. It does not remove copies already installed on recipients’ machines.'
        )}
      </p>
    </div>
  )
}
