import { Terminal } from '@xterm/headless'
import type { IBufferRange, ILink, Terminal as XtermTerminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { createOsc8CursorPositionedLinkProvider } from './osc8-cursor-positioned-link-provider'
import { createOsc8LinkUrlCache } from './osc8-link-url-cache'

const COLS = 110
const URL = 'https://github.com/stablyai/orca/pull/10349#issuecomment-5068238223'
const OPEN = `]8;id=42;${URL}`
const CLOSE = ']8;;'

// A TUI that lays out its own block width emits each row separately, so xterm
// records no `isWrapped` flag even though one link spans both rows.
const WRAPPED_ROWS = [
  `10349 (${OPEN}https://github.com/stablyai/orca/${CLOSE}`,
  `${OPEN}pull/10349#issuecomment-5068238223${CLOSE}) done`
]

async function writeRows(terminal: Terminal, rows: string[]): Promise<void> {
  await new Promise<void>((resolve) => terminal.write(rows.join('\r\n'), () => resolve()))
}

function providerFor(terminal: Terminal, url = URL) {
  const cache = createOsc8LinkUrlCache()
  const xterm = terminal as unknown as XtermTerminal
  const onActivate = vi.fn()
  const onHover = vi.fn()

  // Seed the id -> URL mapping the way xterm's linkHandler would on first hover.
  const seed = (range: IBufferRange): void => cache.remember(xterm, url, range)

  const provider = createOsc8CursorPositionedLinkProvider({
    getTerminal: () => xterm,
    getLinkUrl: (urlId) => cache.get(urlId),
    onActivate,
    onHover,
    onLeave: vi.fn()
  })

  const provideAt = (bufferLineNumber: number): ILink[] | undefined => {
    let links: ILink[] | undefined
    provider.provideLinks(bufferLineNumber, (result) => {
      links = result
    })
    return links
  }

  return { seed, provideAt, onActivate, onHover }
}

describe('OSC 8 cursor-positioned link provider', () => {
  it.each([
    ['the row bearing the scheme', 1],
    ['the continuation row', 2]
  ])('spans both rows when hovering %s', async (_label, bufferLineNumber) => {
    const terminal = new Terminal({ cols: COLS, rows: 20, allowProposedApi: true })
    await writeRows(terminal, WRAPPED_ROWS)
    // Neither row is soft-wrapped, which is why xterm's own provider stops short.
    expect(terminal.buffer.active.getLine(1)?.isWrapped).toBe(false)

    const { seed, provideAt } = providerFor(terminal)
    seed({ start: { x: 8, y: 1 }, end: { x: 40, y: 1 } })

    const links = provideAt(bufferLineNumber)

    expect(links).toHaveLength(1)
    expect(links?.[0].text).toBe(URL)
    expect(links?.[0].range.start.y).toBe(1)
    expect(links?.[0].range.end.y).toBe(2)
    terminal.dispose()
  })

  it('starts the range at the scheme, not the row start', async () => {
    const terminal = new Terminal({ cols: COLS, rows: 20, allowProposedApi: true })
    await writeRows(terminal, WRAPPED_ROWS)
    const { seed, provideAt } = providerFor(terminal)
    seed({ start: { x: 8, y: 1 }, end: { x: 40, y: 1 } })

    // `10349 (` precedes the link, so the run starts at column 8 (1-based).
    expect(provideAt(1)?.[0].range.start.x).toBe(8)
    terminal.dispose()
  })

  it('activates and hovers with the whole URL from the continuation row', async () => {
    const terminal = new Terminal({ cols: COLS, rows: 20, allowProposedApi: true })
    await writeRows(terminal, WRAPPED_ROWS)
    const { seed, provideAt, onActivate, onHover } = providerFor(terminal)
    seed({ start: { x: 8, y: 1 }, end: { x: 40, y: 1 } })

    const link = provideAt(2)![0]
    link.activate({} as MouseEvent, link.text)
    link.hover?.({} as MouseEvent, link.text)

    expect(onActivate).toHaveBeenCalledWith(expect.anything(), URL, link.range)
    expect(onHover).toHaveBeenCalledWith(expect.anything(), URL, link.range)
    terminal.dispose()
  })

  it('leaves single-row links to xterm’s own provider', async () => {
    const terminal = new Terminal({ cols: COLS, rows: 20, allowProposedApi: true })
    await writeRows(terminal, [`see ${OPEN}${URL}${CLOSE} done`])
    const { seed, provideAt } = providerFor(terminal)
    seed({ start: { x: 5, y: 1 }, end: { x: 60, y: 1 } })

    expect(provideAt(1)).toBeUndefined()
    terminal.dispose()
  })

  it('reports nothing when the URL for an id is not known yet', async () => {
    const terminal = new Terminal({ cols: COLS, rows: 20, allowProposedApi: true })
    await writeRows(terminal, WRAPPED_ROWS)
    const { provideAt } = providerFor(terminal)

    expect(provideAt(1)).toBeUndefined()
    terminal.dispose()
  })

  it('does not join adjacent links that carry different ids', async () => {
    const terminal = new Terminal({ cols: COLS, rows: 20, allowProposedApi: true })
    const other = 'https://example.com/other'
    await writeRows(terminal, [
      `${OPEN}https://github.com/stablyai/orca/${CLOSE}`,
      `]8;id=99;${other}${other}${CLOSE}`
    ])
    const { seed, provideAt } = providerFor(terminal)
    seed({ start: { x: 1, y: 1 }, end: { x: 33, y: 1 } })

    // Row 1's run reaches the row end but row 2 belongs to a different link.
    expect(provideAt(1)).toBeUndefined()
    terminal.dispose()
  })
})
