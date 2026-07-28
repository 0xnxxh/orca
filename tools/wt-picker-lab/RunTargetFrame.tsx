import React from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import RunTargetCombobox from '@/components/new-workspace/RunTargetCombobox'
import type { ProjectHostSetupOption } from '@/lib/project-host-setup-options'

const HOSTS: ProjectHostSetupOption[] = [
  {
    kind: 'ready',
    id: 'setup-local',
    projectId: 'p',
    hostId: 'local' as never,
    repoId: 'r',
    label: 'Local Mac',
    detail: 'ready',
    path: '/Users/alice/Developer/work/acme-corp/monorepo/services/checkout'
  },
  {
    kind: 'ready',
    id: 'setup-builder',
    projectId: 'p',
    hostId: 'ssh:builder' as never,
    repoId: 'r',
    label: 'Builder',
    detail: 'ready',
    path: '/workspace/orca'
  },
  {
    kind: 'needs-setup',
    id: 'setup-devbox',
    projectId: 'p',
    hostId: 'ssh:devbox' as never,
    label: 'Devbox',
    detail: 'SSH not connected',
    isAvailable: true,
    attention: false,
    connectAction: { kind: 'ssh', targetId: 'devbox' }
  }
]

const RECIPES = [
  {
    id: 'vercel',
    name: 'Vercel Sandbox',
    create: './scripts/vercel.start.sh',
    destroyDisabled: true
  }
] as never

export default function RunTargetFrame({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [hostId, setHostId] = React.useState<string | null>('setup-local')
  const [recipeId, setRecipeId] = React.useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogTitle className="text-base font-semibold">Create worktree</DialogTitle>
        <div className="min-w-0 space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Run on</label>
          <RunTargetCombobox
            hostOptions={HOSTS}
            hostValue={hostId}
            onHostChange={setHostId}
            recipes={RECIPES}
            recipeValue={recipeId}
            onRecipeChange={setRecipeId}
            onAddSshHost={() => {}}
            onAddRemoteServer={() => {}}
            onConnectHost={async () => await new Promise((r) => setTimeout(r, 1500))}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Name</label>
          <input
            type="text"
            placeholder="Search issues, PRs, or branches"
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
