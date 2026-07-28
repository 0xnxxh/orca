import {
  matchTerminalFileLinkAtColumn,
  parseTerminalFileLinkTarget,
  type TerminalFileLinkTarget
} from '../../../src/shared/terminal-file-link-matcher'

export type TappedFilePath = TerminalFileLinkTarget

export const matchFilePathAtColumn = matchTerminalFileLinkAtColumn
export const parsePathWithOptionalLineColumn = parseTerminalFileLinkTarget
