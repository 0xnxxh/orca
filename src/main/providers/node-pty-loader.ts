import type * as NodePty from 'node-pty'

export type NodePtyModule = typeof NodePty
export type NodePtyImporter = () => Promise<NodePtyModule>

function nodePtyLoadError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `Local terminals could not load node-pty (${detail}). Restart Orca after repairing or reinstalling its native dependencies.`,
    { cause }
  )
}

/** A failed native load is terminal for this process; restart is the only retry boundary. */
export function createNodePtyLoader(importer: NodePtyImporter): () => Promise<NodePtyModule> {
  let loaded: NodePtyModule | undefined
  let inFlight: Promise<NodePtyModule> | undefined
  let failure: Error | undefined

  return (): Promise<NodePtyModule> => {
    if (loaded) {
      return Promise.resolve(loaded)
    }
    if (failure) {
      return Promise.reject(failure)
    }
    if (!inFlight) {
      inFlight = importer().then(
        (module) => {
          loaded = module
          return module
        },
        (cause: unknown) => {
          failure = nodePtyLoadError(cause)
          throw failure
        }
      )
    }
    return inFlight
  }
}

export const loadNodePty = createNodePtyLoader(() => import('node-pty'))
