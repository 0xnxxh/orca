import { AlertTriangle } from 'lucide-react'
import { useSkillFreshness } from '@/hooks/useSkillFreshness'
import { getSkillFreshnessDisplayStatus } from '@/lib/skill-freshness-display-status'
import { skillFreshnessAttentionReason } from './skill-freshness-skipped-reason'

// Why: an amber pill says something is wrong but not what, and a Details link next to
// a status chip is easy to miss. The rails that own the badge state the reason inline
// so the user learns the cause without having to suspect there is more to read.
export function SkillFreshnessAttentionNotice({
  skillName
}: {
  skillName: string
}): React.JSX.Element | null {
  const { inventory } = useSkillFreshness()
  if (getSkillFreshnessDisplayStatus(inventory, skillName) !== 'needs-attention') {
    return null
  }
  const reason = skillFreshnessAttentionReason(inventory, skillName)
  if (!reason) {
    return null
  }
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <span>{reason}</span>
    </p>
  )
}
