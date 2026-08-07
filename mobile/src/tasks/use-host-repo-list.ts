import { useMemo, useReducer, useRef } from 'react'
import {
  hostRepoListReducer,
  initialHostRepoList,
  needsHostRepoListFetch,
  type HostRepoListState
} from './host-repo-list'

export type HostRepoListResource<Repo> = {
  state: HostRepoListState<Repo>
  /** Cached repos when this client already answered, otherwise one fetch. */
  ensureLoaded: () => Promise<Repo[]>
  /** Discards the cache so an explicit refresh re-reads the host. */
  reload: () => Promise<Repo[]>
}

/** Binds the repo list to `clientKey`. Pass `fetchRepos: null` while there is no
 *  usable connection; the resource then stays idle instead of caching an empty
 *  answer that a later client would inherit. */
export function useHostRepoList<Repo>(
  clientKey: unknown,
  fetchRepos: (() => Promise<Repo[]>) | null
): HostRepoListResource<Repo> {
  const [state, dispatch] = useReducer(
    hostRepoListReducer<Repo>,
    undefined,
    initialHostRepoList<Repo>
  )
  const boundKeyRef = useRef(clientKey)
  const reposRef = useRef<Repo[]>([])
  const inFlightRef = useRef<Promise<Repo[]> | null>(null)
  const requestIdRef = useRef(0)
  const fetchRef = useRef(fetchRepos)
  fetchRef.current = fetchRepos

  // Why: an effect runs too late. Expo reuses this screen for the next host, so
  // a render between the swap and the effect would serve the old client's repos
  // to the new one. Resetting here discards them before anything can read them.
  if (boundKeyRef.current !== clientKey) {
    boundKeyRef.current = clientKey
    reposRef.current = []
    inFlightRef.current = null
    dispatch({ type: 'reset' })
  }

  const stateRef = useRef(state)
  stateRef.current = state

  const callbacksRef = useRef<Pick<HostRepoListResource<Repo>, 'ensureLoaded' | 'reload'> | null>(
    null
  )
  if (!callbacksRef.current) {
    const reload = async (): Promise<Repo[]> => {
      const fetchNow = fetchRef.current
      if (!fetchNow) {
        return []
      }
      if (inFlightRef.current) {
        return inFlightRef.current
      }
      // Why: only the request issued for the currently bound client may commit.
      // A slow response from the previous host would otherwise land afterwards
      // and pin its repos as this host's authoritative list.
      const requestKey = boundKeyRef.current
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const request = (async (): Promise<Repo[]> => {
        dispatch({ type: 'requested' })
        try {
          const repos = await fetchNow()
          // Why: A -> B -> A reuses the same client, so matching the key alone
          // would let a stale request for A overwrite a newer result for A.
          if (boundKeyRef.current !== requestKey || requestIdRef.current !== requestId) {
            return []
          }
          reposRef.current = repos
          dispatch({ type: 'resolved', repos })
          return repos
        } catch (err) {
          if (boundKeyRef.current === requestKey && requestIdRef.current === requestId) {
            dispatch({
              type: 'failed',
              error: err instanceof Error ? err.message : 'Unknown error'
            })
          }
          throw err
        } finally {
          if (requestIdRef.current === requestId) {
            inFlightRef.current = null
          }
        }
      })()
      inFlightRef.current = request
      return request
    }
    callbacksRef.current = {
      // Why: within one event React has not rendered the `requested` dispatch
      // yet, so the status still reads `loaded`. Join the in-flight request
      // instead of handing back the list it is about to replace.
      ensureLoaded: () =>
        inFlightRef.current ??
        (needsHostRepoListFetch(stateRef.current) ? reload() : Promise.resolve(reposRef.current)),
      reload
    }
  }
  // Why: consumers put this in dependency arrays. A fresh object per render
  // would re-create their callbacks every render and spin their effects.
  const callbacks = callbacksRef.current
  return useMemo(() => ({ state, ...callbacks }), [callbacks, state])
}
