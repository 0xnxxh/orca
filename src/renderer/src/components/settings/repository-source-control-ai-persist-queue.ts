import type { RepoSourceControlAiOverrides } from '../../../../shared/source-control-ai-types'
import { normalizeRepoSourceControlAiOverrides } from '../../../../shared/source-control-ai'
import { toSourceControlAiRepoUpdate } from '../../../../shared/source-control-ai-recipe-save'
import type { SourceControlAiRepoUpdate } from '../../../../shared/source-control-ai-recipe-save'

type PersistQueueOptions = {
  getRepoId: () => string
  getPersisted: () => RepoSourceControlAiOverrides
  setPersisted: (value: RepoSourceControlAiOverrides) => void
  updateRepo: (repoId: string, updates: SourceControlAiRepoUpdate) => void | Promise<boolean>
  isMounted: () => boolean
  onError: (message: string) => void
}

/** Serializes nested sourceControlAi writes so concurrent field updates cannot clobber each other. */
export function createRepoAiPersistQueue(options: PersistQueueOptions) {
  let chain: Promise<void> = Promise.resolve()

  const persistTransform = (
    transform: (base: RepoSourceControlAiOverrides) => RepoSourceControlAiOverrides
  ): Promise<void> => {
    const run = chain
      .catch(() => undefined)
      .then(async () => {
        const next = transform(options.getPersisted())
        if (JSON.stringify(next) === JSON.stringify(options.getPersisted())) {
          return
        }
        const repoUpdate = toSourceControlAiRepoUpdate(next)
        try {
          const result = await options.updateRepo(options.getRepoId(), repoUpdate)
          if (!options.isMounted()) {
            return
          }
          if (result === false) {
            options.onError('Failed to save Source Control AI settings.')
            return
          }
          const savedValue =
            repoUpdate.sourceControlAi === null
              ? {}
              : (normalizeRepoSourceControlAiOverrides(repoUpdate.sourceControlAi) ?? {})
          options.setPersisted(savedValue)
        } catch {
          if (options.isMounted()) {
            options.onError('Failed to save Source Control AI settings.')
          }
        }
      })
    chain = run
    return run
  }

  return { persistTransform }
}
