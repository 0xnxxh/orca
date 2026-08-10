import { translate } from '@/i18n/i18n'

export const GITHUB_CHECK_DETAILS_TIMEOUT_MS = 30_000

/** Bound local IPC the same way runtime RPC bounds remote check-detail requests. */
export async function withGitHubCheckDetailsTimeout<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          translate(
            'auto.runtime.githubCheckDetailsTimeout.timedOut',
            'Timed out loading check details.'
          )
        )
      )
    }, GITHUB_CHECK_DETAILS_TIMEOUT_MS)
  })
  try {
    return await Promise.race([pending, timeout])
  } finally {
    clearTimeout(timer)
  }
}
