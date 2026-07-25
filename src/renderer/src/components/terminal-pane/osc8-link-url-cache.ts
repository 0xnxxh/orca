import type { IBufferLine, IBufferRange } from '@xterm/xterm'
import { readOsc8UrlId } from './osc8-cursor-positioned-link-provider'

type CacheTerminal = {
  buffer: { active: { getLine(y: number): IBufferLine | undefined } }
}

// Why: one entry per distinct OSC 8 id on screen; bounded so a long session
// cannot grow it without limit.
const MAX_TRACKED_LINKS = 512

/**
 * Maps xterm's internal OSC 8 `urlId` to the URL it stands for.
 *
 * xterm resolves that mapping in a service it does not expose, but it hands
 * both the URL and the link's buffer range to `linkHandler`. Reading the
 * `urlId` off a cell inside that range recovers the association without
 * reaching into private state.
 */
export function createOsc8LinkUrlCache(): {
  remember: (terminal: CacheTerminal, url: string, range: IBufferRange) => void
  get: (urlId: number) => string | undefined
} {
  const urlsById = new Map<number, string>()

  return {
    remember: (terminal, url, range) => {
      const line = terminal.buffer.active.getLine(range.start.y - 1)
      // Why: ranges are 1-based inclusive; the first cell of the run is at
      // `start.x - 1`.
      const urlId = readOsc8UrlId(line?.getCell(range.start.x - 1))
      if (urlId === undefined) {
        return
      }
      if (urlsById.size >= MAX_TRACKED_LINKS && !urlsById.has(urlId)) {
        const oldest = urlsById.keys().next().value
        if (oldest !== undefined) {
          urlsById.delete(oldest)
        }
      }
      urlsById.set(urlId, url)
    },
    get: (urlId) => urlsById.get(urlId)
  }
}
