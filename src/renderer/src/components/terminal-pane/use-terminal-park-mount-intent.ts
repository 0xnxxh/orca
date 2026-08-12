import { useRef } from 'react'
import { isTerminalTabParked } from './terminal-parked-watcher-registry'

export function useTerminalParkMountIntent(tabId: string): boolean {
  const followsParkRef = useRef<boolean | null>(null)
  if (followsParkRef.current === null) {
    followsParkRef.current = isTerminalTabParked(tabId)
  }
  return followsParkRef.current
}
