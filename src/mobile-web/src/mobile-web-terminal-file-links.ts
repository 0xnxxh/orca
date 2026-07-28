import type { IBuffer, IBufferCellPosition, ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import {
  findTerminalFileLinks,
  type TerminalFileLinkTarget
} from '../../shared/terminal-file-link-matcher'
import { MOBILE_WEB_TERMINAL_PATH_MAX_CHARACTERS } from '../../shared/mobile-web/terminal-artifact-contract'

export const MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_ROWS = 8
export const MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_CHARACTERS = 4096

type TerminalLinkSource = Pick<Terminal, 'buffer' | 'cols'>

type LogicalTerminalLine = {
  text: string
  positions: { start: IBufferCellPosition; end: IBufferCellPosition }[]
}

export function createMobileWebTerminalFileLinkProvider(
  terminal: TerminalLinkSource,
  activate: (target: TerminalFileLinkTarget) => void
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      callback(buildMobileWebTerminalFileLinks(terminal, bufferLineNumber, activate))
    }
  }
}

export function buildMobileWebTerminalFileLinks(
  terminal: TerminalLinkSource,
  bufferLineNumber: number,
  activate: (target: TerminalFileLinkTarget) => void
): ILink[] | undefined {
  const logicalLine = readLogicalTerminalLine(
    terminal.buffer.active,
    terminal.cols,
    bufferLineNumber
  )
  if (!logicalLine) {
    return undefined
  }
  const links = findTerminalFileLinks(logicalLine.text).flatMap((match): ILink[] => {
    if (match.pathText.length > MOBILE_WEB_TERMINAL_PATH_MAX_CHARACTERS) {
      return []
    }
    const start = logicalLine.positions[match.startIndex]
    const end = logicalLine.positions[match.endIndex - 1]
    if (!start || !end || bufferLineNumber < start.start.y || bufferLineNumber > end.end.y) {
      return []
    }
    const target = {
      pathText: match.pathText,
      line: match.line,
      column: match.column
    }
    return [
      {
        range: { start: start.start, end: end.end },
        text: logicalLine.text.slice(match.startIndex, match.endIndex),
        activate: () => activate(target)
      }
    ]
  })
  return links.length > 0 ? links : undefined
}

function readLogicalTerminalLine(
  buffer: IBuffer,
  columns: number,
  requestedLineNumber: number
): LogicalTerminalLine | null {
  const requestedIndex = requestedLineNumber - 1
  if (requestedIndex < 0 || requestedIndex >= buffer.length || !buffer.getLine(requestedIndex)) {
    return null
  }
  let startIndex = requestedIndex
  let rowCount = 1
  while (startIndex > 0 && buffer.getLine(startIndex)?.isWrapped) {
    if (rowCount >= MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_ROWS) {
      return null
    }
    startIndex -= 1
    rowCount += 1
  }
  let endIndex = requestedIndex
  while (endIndex + 1 < buffer.length && buffer.getLine(endIndex + 1)?.isWrapped) {
    if (rowCount >= MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_ROWS) {
      return null
    }
    endIndex += 1
    rowCount += 1
  }

  let text = ''
  const positions: LogicalTerminalLine['positions'] = []
  for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex += 1) {
    const line = buffer.getLine(rowIndex)
    if (!line) {
      return null
    }
    const width = Math.min(columns, line.length)
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const cell = line.getCell(columnIndex)
      if (!cell || cell.getWidth() === 0) {
        continue
      }
      const characters = cell.getChars() || ' '
      const position = {
        start: { x: columnIndex + 1, y: rowIndex + 1 },
        end: { x: columnIndex + cell.getWidth(), y: rowIndex + 1 }
      }
      text += characters
      for (let characterIndex = 0; characterIndex < characters.length; characterIndex += 1) {
        positions.push(position)
      }
      if (text.length > MOBILE_WEB_TERMINAL_LINK_MAX_LOGICAL_CHARACTERS) {
        return null
      }
    }
  }
  while (text.endsWith(' ')) {
    text = text.slice(0, -1)
    positions.pop()
  }
  return text ? { text, positions } : null
}
