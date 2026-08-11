import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, FileCode2, Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { OrcaOrgMember } from '../../../../shared/orca-profiles'
import type {
  SkillSharePreview,
  SkillShareProgress
} from '../../../../shared/skill-sharing-contract'
import type { DiscoveredSkill } from '../../../../shared/skills'

type SkillShareDialogProps = {
  skill: DiscoveredSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SelectableOrgMember = OrcaOrgMember & { userId: string }

function byteLabel(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  skill,
  open,
  onOpenChange
}: SkillShareDialogProps): React.JSX.Element {
  const [preview, setPreview] = useState<SkillSharePreview | null>(null)
  const [members, setMembers] = useState<SelectableOrgMember[]>([])
  const [author, setAuthor] = useState('')
  const [organization, setOrganization] = useState('')
  const [audience, setAudience] = useState<'organization' | 'people'>('organization')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [releaseNotes, setReleaseNotes] = useState('')
  const [progress, setProgress] = useState<SkillShareProgress | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    if (!open || !skill) {
      return
    }
    const current = ++generation.current
    setPreview(null)
    setShareUrl(null)
    setProgress(null)
    setError(null)
    setPreparing(true)
    void Promise.all([
      window.api.skills.prepareShare({ skillId: skill.id }),
      window.api.orcaProfiles.authStatus()
    ])
      .then(async ([nextPreview, auth]) => {
        if (generation.current !== current) {
          await window.api.skills.releaseShare(nextPreview.preparationId)
          return
        }
        setPreview(nextPreview)
        const cloud = auth.cloud
        setAuthor(cloud?.displayName || cloud?.email || '')
        setOrganization(cloud?.activeOrgName || '')
        if (!cloud?.activeOrgId) {
          setAudience('people')
          setMembers([])
          return
        }
        const result = await window.api.orcaProfiles.orgMembersList({ orgId: cloud.activeOrgId })
        if (generation.current === current && result.status === 'ok') {
          setMembers(
            result.roster.members.filter(
              (member): member is SelectableOrgMember =>
                Boolean(member.userId) && member.userId !== cloud.userId
            )
          )
        }
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
  }, [open, skill])

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
    if (audience === 'people' && selectedUserIds.length === 0) {
      setError(
        translate(
          'auto.components.skills.SkillShareDialog.peopleRequired',
          'Select at least one teammate.'
        )
      )
      return
    }
    setPublishing(true)
    setError(null)
    try {
      const result = await window.api.skills.publishShare({
        preparationId: preview.preparationId,
        releaseNotes,
        userIds: audience === 'people' ? selectedUserIds : [],
        shareWithOrganization: audience === 'organization'
      })
      if (result.status !== 'ok') {
        setError(operationError(result.status))
        return
      }
      setShareUrl(result.value.share.url)
    } catch (cause) {
      console.warn('[skills] publish failed:', cause)
      setError(
        translate(
          'auto.components.skills.SkillShareDialog.publishFailed',
          'Could not publish this skill. The prepared copy is still available to retry.'
        )
      )
    } finally {
      setPublishing(false)
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
        <DialogHeader>
          <DialogTitle>
            {shareUrl
              ? translate('auto.components.skills.SkillShareDialog.ready', 'Skill link ready')
              : translate('auto.components.skills.SkillShareDialog.title', 'Share skill')}
          </DialogTitle>
          <DialogDescription>
            {shareUrl
              ? translate(
                  'auto.components.skills.SkillShareDialog.readyDescription',
                  'Recipients authenticate with Orca before they can inspect or install it.'
                )
              : translate(
                  'auto.components.skills.SkillShareDialog.description',
                  'Review the exact files, choose who can access them, then publish an immutable version.'
                )}
          </DialogDescription>
        </DialogHeader>

        {preparing ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate('auto.components.skills.SkillShareDialog.preparing', 'Preparing preview…')}
          </div>
        ) : preview && !shareUrl ? (
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
                onValueChange={(value) => setAudience(value as typeof audience)}
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
                                setSelectedUserIds((current) =>
                                  next
                                    ? [...new Set([...current, member.userId])]
                                    : current.filter((id) => id !== member.userId)
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
                onChange={(event) => setReleaseNotes(event.target.value)}
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
        ) : shareUrl ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Check className="size-4" />
              </div>
              <p className="min-w-0 flex-1 truncate font-mono text-xs">{shareUrl}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
                <Clipboard className="size-4" /> Copy link
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Revoking this link blocks future access. It does not remove copies already installed
              on recipients’ machines.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => void close()} disabled={publishing}>
            {shareUrl ? 'Done' : 'Cancel'}
          </Button>
          {!shareUrl ? (
            publishing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => preview && window.api.skills.cancelShare(preview.preparationId)}
              >
                Cancel upload
              </Button>
            ) : (
              <Button type="button" disabled={!preview || preparing} onClick={() => void publish()}>
                <Share2 className="size-4" /> Publish skill
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
