export type JsonTextStructureLimits = Readonly<{
  structuralTokens: number
  nestingDepth: number
}>

export class JsonTextStructureCapacityError extends Error {
  constructor(
    readonly resource: keyof JsonTextStructureLimits,
    readonly limit: number
  ) {
    super(
      resource === 'structuralTokens'
        ? `JSON structure exceeds ${limit} tokens`
        : `JSON nesting exceeds ${limit} levels`
    )
    this.name = 'JsonTextStructureCapacityError'
  }
}

export function assertJsonTextStructureWithinLimits(
  content: string,
  limits: JsonTextStructureLimits
): void {
  assertLimit(limits.structuralTokens)
  assertLimit(limits.nestingDepth)
  let structuralTokens = 0
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (!isStructuralToken(character)) {
      continue
    }
    structuralTokens += 1
    if (structuralTokens > limits.structuralTokens) {
      throw new JsonTextStructureCapacityError('structuralTokens', limits.structuralTokens)
    }
    if (character === '{' || character === '[') {
      depth += 1
      if (depth > limits.nestingDepth) {
        throw new JsonTextStructureCapacityError('nestingDepth', limits.nestingDepth)
      }
    } else if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
}

function assertLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('JSON structure limits must be non-negative safe integers')
  }
}

function isStructuralToken(character: string | undefined): boolean {
  return (
    character === '{' ||
    character === '}' ||
    character === '[' ||
    character === ']' ||
    character === ',' ||
    character === ':'
  )
}

// Guard-then-parse in one call so a bare `JSON.parse` in review (and in the bounded-ingress ratchet)
// genuinely means "unguarded", instead of every sanctioned call site needing a justification comment.
export function parseJsonWithinStructureLimits<T>(
  content: string,
  limits: JsonTextStructureLimits
): T {
  assertJsonTextStructureWithinLimits(content, limits)
  // bounded-by: structure asserted on the line above
  return JSON.parse(content) as T
}
