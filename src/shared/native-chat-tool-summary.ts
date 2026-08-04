import { isToolCallBlock, type NativeChatBlock } from './native-chat-types'

const MAX_PREVIEW_LENGTH = 80
const MAX_PREVIEW_STRING_INPUT = 160
const MAX_PREVIEW_COLLECTION_ITEMS = 8
const MAX_PREVIEW_DEPTH = 2
const MAX_TOOL_RUN_SUMMARY_PARTS = 3
const PRIMARY_ARG_KEYS = ['command', 'cmd', 'query', 'pattern', 'url', 'description'] as const
const BRIEF_ARG_KEYS = ['command', 'cmd', 'query', 'pattern'] as const

export function summarizeToolInput(input: unknown): string {
  const collapsed = toRawPreview(input).replace(/\s+/g, ' ').trim()
  return collapsed.length <= MAX_PREVIEW_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_PREVIEW_LENGTH - 1)}…`
}

/** Human label for a tool line: the target file path, else the primary string
 *  argument (command/query/…), else the bounded JSON preview. Keeps raw
 *  `{"file_path":…}` JSON out of the tappable row label. */
export function describeToolInput(input: unknown): string {
  const normalized = normalizeToolInput(input)
  const path = toolFilePath(normalized)
  if (path) {
    return summarizeToolPath(path)
  }
  if (normalized && typeof normalized === 'object') {
    // Concrete target/action first; prose `description` only as a last resort.
    const primary = firstPrimaryToolArg(normalized as Record<string, unknown>, PRIMARY_ARG_KEYS)
    if (primary) {
      return primary
    }
  }
  return summarizeToolInput(normalized)
}

/** Full, pretty-printed tool-call input for the expanded detail view. Structured
 *  JSON strings and objects/arrays print as indented JSON so a diff-less call
 *  (e.g. a question payload) reads cleanly instead of one long minified line;
 *  other strings pass through as-is. */
export function formatToolInput(input: unknown): string {
  const normalized = normalizeToolInput(input)
  if (normalized === null || normalized === undefined) {
    return ''
  }
  if (typeof normalized === 'string') {
    return normalized
  }
  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return String(normalized)
  }
  try {
    return JSON.stringify(normalized, null, 2) ?? ''
  } catch {
    return ''
  }
}

/** Whether the expanded detail would show structured JSON rather than repeating
 *  the row label — i.e. whether expanding the row is worth offering. */
export function isStructuredToolInput(input: unknown): boolean {
  const normalized = normalizeToolInput(input)
  if (normalized === null || typeof normalized !== 'object') {
    return false
  }
  // An empty object formats back to the row label verbatim, so offering the
  // expander would promise detail and then repeat the row.
  return Array.isArray(normalized) ? normalized.length > 0 : Object.keys(normalized).length > 0
}

export function toolFilePath(input: unknown): string | null {
  const normalized = normalizeToolInput(input)
  if (!normalized || typeof normalized !== 'object') {
    return null
  }
  const value = normalized as Record<string, unknown>
  // A search call's `path` is the directory it scanned, not a file it opened —
  // taking it would drop the pattern from the label and offer a link to a folder.
  const directory = isSearchToolInput(value) ? undefined : value.path
  const path = value.file_path ?? value.filePath ?? directory ?? value.notebook_path
  return typeof path === 'string' && path.length > 0 ? path : null
}

export function briefToolArg(input: unknown): string {
  const normalized = normalizeToolInput(input)
  if (normalized && typeof normalized === 'object') {
    const path = toolFilePath(normalized)
    if (path) {
      const parts = path.split(/[\\/]/).filter(Boolean)
      return parts.at(-1) ?? path
    }
    const command = firstPrimaryToolArg(normalized as Record<string, unknown>, BRIEF_ARG_KEYS)
    if (command) {
      return command.slice(0, 28)
    }
  }
  return summarizeToolInput(normalized).slice(0, 28)
}

/** Codex delivers tool arguments as a JSON string. Parse those into the object
 *  shape every helper below already understands; leave prose strings alone. */
function normalizeToolInput(input: unknown): unknown {
  if (typeof input !== 'string') {
    return input
  }
  const first = input.trimStart()[0]
  if (first !== '{' && first !== '[') {
    return input
  }
  try {
    const parsed: unknown = JSON.parse(input)
    return parsed !== null && typeof parsed === 'object' ? parsed : input
  } catch {
    return input
  }
}

/** A search call is named by what it looked for, so its `path` is a scan root
 *  rather than a file target. */
function isSearchToolInput(value: Record<string, unknown>): boolean {
  return (
    summarizePrimaryToolArg(value.query) !== null || summarizePrimaryToolArg(value.pattern) !== null
  )
}

/** The first key that yields a label — a present-but-blank key must not swallow
 *  the keys ranked after it. */
function firstPrimaryToolArg(
  value: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const summary = summarizePrimaryToolArg(value[key])
    if (summary) {
      return summary
    }
  }
  return null
}

/** A path is identified by its tail, so trim from the front: head-truncating an
 *  absolute path drops the filename, the one part that tells two rows apart. */
function summarizeToolPath(path: string): string {
  const collapsed = path.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= MAX_PREVIEW_LENGTH) {
    return collapsed
  }
  const tail = collapsed.slice(collapsed.length - (MAX_PREVIEW_LENGTH - 1))
  // Start at a segment boundary so the label doesn't open mid-name.
  const boundary = tail.search(/[\\/]/)
  return `…${boundary > 0 ? tail.slice(boundary) : tail}`
}

/** A label-worthy primary argument: a non-blank string, or an argv array. */
function summarizePrimaryToolArg(input: unknown): string | null {
  if (typeof input === 'string' && input.trim()) {
    return summarizeToolInput(input)
  }
  if (Array.isArray(input) && input.length > 0 && input.every((part) => typeof part === 'string')) {
    return summarizeToolInput(input.join(' '))
  }
  return null
}

export function summarizeToolRun(blocks: readonly NativeChatBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (!isToolCallBlock(block)) {
      continue
    }
    const name = block.name.trim()
    if (!name) {
      continue
    }
    const detail = briefToolArg(block.input)
    parts.push(detail ? `${name} ${detail}` : name)
    if (parts.length >= MAX_TOOL_RUN_SUMMARY_PARTS) {
      break
    }
  }
  return parts.join('  ·  ')
}

export function countToolCalls(blocks: readonly NativeChatBlock[]): number {
  return blocks.filter(isToolCallBlock).length
}

function toRawPreview(input: unknown): string {
  if (input === null || input === undefined) {
    return ''
  }
  if (typeof input === 'string') {
    return input
  }
  if (typeof input !== 'object') {
    return String(input)
  }
  try {
    return JSON.stringify(boundedPreviewValue(input, 0, new WeakSet<object>())) ?? ''
  } catch {
    return ''
  }
}

function boundedPreviewValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_PREVIEW_STRING_INPUT
      ? `${value.slice(0, MAX_PREVIEW_STRING_INPUT)}…`
      : value
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[circular]'
  }
  if (depth >= MAX_PREVIEW_DEPTH) {
    return '[…]'
  }
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_PREVIEW_COLLECTION_ITEMS)
      .map((item) => boundedPreviewValue(item, depth + 1, seen))
    if (value.length > MAX_PREVIEW_COLLECTION_ITEMS) {
      result.push('…')
    }
    return result
  }
  const result: Record<string, unknown> = {}
  let count = 0
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue
    }
    if (count >= MAX_PREVIEW_COLLECTION_ITEMS) {
      result['…'] = '…'
      break
    }
    result[key] = boundedPreviewValue((value as Record<string, unknown>)[key], depth + 1, seen)
    count += 1
  }
  return result
}
