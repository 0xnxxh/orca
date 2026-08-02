import type { GitHubOwnerRepo } from '../../../../shared/types'

export type GitHubMarkdownComposerProps = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  minHeightClassName?: string
  className?: string
  disabled?: boolean
  autoFocus?: boolean
  onSubmitShortcut?: () => void
  layout?: 'stacked' | 'tabbed'
  previewGithubRepo?: GitHubOwnerRepo | null
}
