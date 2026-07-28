import { describe, expect, it, vi } from 'vitest'
import type { IBuffer, IBufferLine, Terminal } from '@xterm/xterm'
import {
  MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_ROWS,
  buildMobileWebTerminalFileLinks
} from './mobile-web-terminal-file-links'

describe('mobile web terminal file links', () => {
  it('maps an ASCII path to one-based xterm cells', () => {
    const activate = vi.fn()
    const links = buildMobileWebTerminalFileLinks(
      terminalWithLines([asciiLine('created /tmp/report.txt')]),
      1,
      activate
    )

    expect(links).toHaveLength(1)
    expect(links?.[0]).toMatchObject({
      range: { start: { x: 9, y: 1 }, end: { x: 23, y: 1 } },
      text: '/tmp/report.txt'
    })
    links?.[0]?.activate({} as MouseEvent, '/tmp/report.txt')
    expect(activate).toHaveBeenCalledWith({
      pathText: '/tmp/report.txt',
      line: null,
      column: null
    })
  })

  it('keeps adjacent absolute paths as independent links', () => {
    const links = buildMobileWebTerminalFileLinks(
      terminalWithLines([asciiLine('/etc/hosts /tmp/output.png')]),
      1,
      vi.fn()
    )

    expect(links?.map((link) => ({ range: link.range, text: link.text }))).toEqual([
      {
        range: { start: { x: 1, y: 1 }, end: { x: 10, y: 1 } },
        text: '/etc/hosts'
      },
      {
        range: { start: { x: 12, y: 1 }, end: { x: 26, y: 1 } },
        text: '/tmp/output.png'
      }
    ])
  })

  it('uses cell widths instead of UTF-16 indices after emoji', () => {
    const links = buildMobileWebTerminalFileLinks(
      terminalWithLines([
        lineFromCells([
          { characters: '🙂', width: 2 },
          { characters: '', width: 0 },
          { characters: ' ', width: 1 },
          ...asciiCells('/tmp/a.ts')
        ])
      ]),
      1,
      vi.fn()
    )

    expect(links?.[0]?.range).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 12, y: 1 }
    })
  })

  it('creates one link across a bounded soft-wrapped logical line', () => {
    const terminal = terminalWithLines([asciiLine('/tmp/very/'), asciiLine('long.txt', true)])

    const firstRow = buildMobileWebTerminalFileLinks(terminal, 1, vi.fn())
    const secondRow = buildMobileWebTerminalFileLinks(terminal, 2, vi.fn())

    expect(firstRow?.[0]?.range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 8, y: 2 }
    })
    expect(secondRow?.[0]?.range).toEqual(firstRow?.[0]?.range)
  })

  it('fails closed when a logical line exceeds the row bound', () => {
    const lines = Array.from(
      { length: MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_ROWS + 1 },
      (_, index) =>
        asciiLine(index === 0 ? '/tmp/' : index === 8 ? 'file.txt' : 'segment/', index > 0)
    )
    expect(buildMobileWebTerminalFileLinks(terminalWithLines(lines), 5, vi.fn())).toBeUndefined()
  })
})

type Cell = { characters: string; width: number }

function terminalWithLines(lines: IBufferLine[]): Pick<Terminal, 'buffer' | 'cols'> {
  const buffer = {
    length: lines.length,
    getLine: (index: number) => lines[index]
  } as unknown as IBuffer
  return {
    cols: Math.max(...lines.map((line) => line.length)),
    buffer: { active: buffer }
  } as Pick<Terminal, 'buffer' | 'cols'>
}

function asciiLine(value: string, isWrapped = false): IBufferLine {
  return lineFromCells(asciiCells(value), isWrapped)
}

function asciiCells(value: string): Cell[] {
  return [...value].map((characters) => ({ characters, width: 1 }))
}

function lineFromCells(cells: Cell[], isWrapped = false): IBufferLine {
  return {
    isWrapped,
    length: cells.length,
    getCell: (index: number) => {
      const cell = cells[index]
      return cell
        ? ({
            getChars: () => cell.characters,
            getWidth: () => cell.width
          } as ReturnType<IBufferLine['getCell']>)
        : undefined
    }
  } as IBufferLine
}
