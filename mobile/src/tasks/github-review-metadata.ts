import { t } from '../i18n/mobile-i18n'

export function githubReviewStateLabel(state: string | null | undefined): string {
  switch (state) {
    case 'APPROVED':
      return t('m.IloG18k')
    case 'CHANGES_REQUESTED':
      return t('m.rjj84-Y')
    case 'COMMENTED':
      return t('m.bF0aphw')
    case 'DISMISSED':
      return t('m.dmAcep8')
    case 'PENDING':
      return t('m.NEg29tM')
    default:
      return t('m._IeDTL8')
  }
}

export function githubPullRequestDelta(item: {
  additions?: number
  deletions?: number
  changedFiles?: number
}): string | null {
  const parts: string[] = []
  if (typeof item.additions === 'number') {
    parts.push(`+${item.additions}`)
  }
  if (typeof item.deletions === 'number') {
    parts.push(`-${item.deletions}`)
  }
  if (typeof item.changedFiles === 'number') {
    parts.push(
      t(item.changedFiles === 1 ? 'review.changedFiles.one' : 'review.changedFiles.other', {
        count: item.changedFiles
      })
    )
  }
  return parts.length > 0 ? parts.join(' ') : null
}
