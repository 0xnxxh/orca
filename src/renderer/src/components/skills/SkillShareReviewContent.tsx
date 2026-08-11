import { Check, Clipboard, FileCode2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { OrcaOrgMember } from '../../../../shared/orca-profiles'
import type {
  SkillSharePreview,
  SkillShareProgress
} from '../../../../shared/skill-sharing-contract'

export type SelectableOrgMember = OrcaOrgMember & { userId: string }

export function SkillShareDialogHeader({
  published,
  publishingNewVersion
}: {
  published: boolean
  publishingNewVersion: boolean
}): React.JSX.Element {
  return (
    <DialogHeader>
      <DialogTitle>
        {published
          ? translate('auto.components.skills.SkillShareDialog.ready', 'Skill link ready')
          : publishingNewVersion
            ? 'Publish new skill version'
            : translate('auto.components.skills.SkillShareDialog.title', 'Share skill')}
      </DialogTitle>
      <DialogDescription>
        {published
          ? translate(
              'auto.components.skills.SkillShareDialog.readyDescription',
              'Recipients authenticate with Orca before they can inspect or install it.'
            )
          : translate(
              'auto.components.skills.SkillShareDialog.description',
              publishingNewVersion
                ? 'Review the exact files, then publish an immutable version to the existing Cloud package.'
                : 'Review the exact files, choose who can access them, then publish an immutable version.'
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

export function SkillSharePreparationReview({
  preview,
  author,
  organization,
  audience,
  onAudienceChange,
  members,
  selectedUserIds,
  onSelectedUserIdsChange,
  releaseNotes,
  onReleaseNotesChange,
  publishing,
  progress,
  progressPercent
}: {
  preview: SkillSharePreview
  author: string
  organization: string
  audience: 'organization' | 'people'
  onAudienceChange: (audience: 'organization' | 'people') => void
  members: SelectableOrgMember[]
  selectedUserIds: string[]
  onSelectedUserIdsChange: (userIds: string[]) => void
  releaseNotes: string
  onReleaseNotesChange: (notes: string) => void
  publishing: boolean
  progress: SkillShareProgress | null
  progressPercent: number
}): React.JSX.Element {
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
          <Badge variant="outline">{preview.fileCount} files</Badge>
          <Badge variant="outline">{byteLabel(preview.totalBytes)}</Badge>
          <Badge variant="outline">{preview.scriptPaths.length} scripts</Badge>
          <Badge variant="outline">{preview.executablePaths.length} executable</Badge>
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          SHA-256 {preview.packageDigest}
        </p>
      </section>

      <section className="space-y-2">
        <div className="space-y-1">
          <Label>Access</Label>
          <p className="text-xs text-muted-foreground">
            {author
              ? `Publishing as ${author}${organization ? ` in ${organization}` : ''}.`
              : 'A connected Orca Cloud account is required.'}
          </p>
        </div>
        <Tabs
          value={audience}
          onValueChange={(value) => onAudienceChange(value as typeof audience)}
        >
          <TabsList aria-label="Skill access">
            <TabsTrigger value="organization" disabled={!organization}>
              Organization
            </TabsTrigger>
            <TabsTrigger value="people">Selected people</TabsTrigger>
          </TabsList>
          <TabsContent value="organization" className="pt-2 text-xs text-muted-foreground">
            Everyone currently in {organization || 'the organization'} can access the link.
          </TabsContent>
          <TabsContent value="people" className="space-y-2 pt-2">
            {members.length > 0 ? (
              <div className="max-h-32 space-y-1 overflow-y-auto scrollbar-sleek rounded-md border border-border p-2">
                {members.map((member) => {
                  const checked = selectedUserIds.includes(member.userId)
                  return (
                    <label
                      key={member.userId}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          onSelectedUserIdsChange(
                            next
                              ? [...new Set([...selectedUserIds, member.userId])]
                              : selectedUserIds.filter((id) => id !== member.userId)
                          )
                        }
                      />
                      <span className="min-w-0 truncate text-xs">
                        {member.displayName || member.email}
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No teammates are available.</p>
            )}
          </TabsContent>
        </Tabs>
      </section>

      <section className="space-y-2">
        <Label htmlFor="skill-release-notes">Release notes</Label>
        <textarea
          id="skill-release-notes"
          value={releaseNotes}
          onChange={(event) => onReleaseNotesChange(event.target.value)}
          maxLength={10_000}
          placeholder="What changed in this version?"
          className="min-h-20 w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </section>

      {publishing ? (
        <section className="space-y-2" aria-live="polite">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress?.phase === 'finalizing' ? 'Validating and publishing…' : 'Uploading…'}
            </span>
            <span>{progress?.phase === 'finalizing' ? '100%' : `${progressPercent}%`}</span>
          </div>
          <Progress value={progress?.phase === 'finalizing' ? 100 : progressPercent} />
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
          <Clipboard className="size-4" /> Copy link
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Revoking this link blocks future access. It does not remove copies already installed on
        recipients’ machines.
      </p>
    </div>
  )
}
