import { builtinModules } from 'node:module'
import type { Plugin, Rollup } from 'vite'

type NormalizedOutputOptions = Rollup.NormalizedOutputOptions
type OutputBundle = Rollup.OutputBundle
type OutputChunk = Rollup.OutputChunk

const SANDBOX_UNSUPPORTED_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
])

/** The only module a sandboxed preload can resolve; everything else throws at load. */
const SANDBOX_SUPPORTED_EXTERNALS = new Set(['electron'])

// `[\w$]*require` also catches bundler-renamed shims such as `__require("fs")`.
const LITERAL_MODULE_CALL_RE = /(?<![\w$.])(?:[\w$]*require|import)\s*\(\s*(['"])([^'"]*)\1\s*\)/g
const NONLITERAL_MODULE_CALL_RE =
  /(?<![\w$.])(?:[\w$]*require|import)\s*\((?!\s*(['"])[^'"]*\1\s*\))/g
// Anchored at statement position so a quoted `from` inside bundled data can't match.
const STATIC_MODULE_SOURCE_RE =
  /(?:^|[;}])\s*(?:import|export)\s+(?:[^'";()]*?\bfrom\s*)?(['"])([^'"]*)\1/gm

export type PreloadSandboxViolationKind =
  | 'node-builtin'
  | 'unsupported-external'
  | 'helper-chunk'
  | 'nonliteral-module-request'

export type PreloadSandboxViolation = Readonly<{
  kind: PreloadSandboxViolationKind
  /** The module specifier, or the call source for a non-literal request. */
  detail: string
}>

const VIOLATION_LABELS: Record<PreloadSandboxViolationKind, string> = {
  'node-builtin': 'unsupported Node builtins',
  'unsupported-external': 'unsupported bare externals',
  'helper-chunk': 'unloadable emitted chunks',
  'nonliteral-module-request': 'non-literal module requests'
}

function classifySpecifier(specifier: string): PreloadSandboxViolation | null {
  if (SANDBOX_SUPPORTED_EXTERNALS.has(specifier)) {
    return null
  }
  if (SANDBOX_UNSUPPORTED_BUILTINS.has(specifier)) {
    return { kind: 'node-builtin', detail: specifier }
  }
  // Rollup names a shared chunk by its emitted path, which is bare relative to the output dir.
  if (/^[./]/.test(specifier) || /\.[cm]?js$/.test(specifier)) {
    return { kind: 'helper-chunk', detail: specifier }
  }
  return { kind: 'unsupported-external', detail: specifier }
}

function collect(
  violations: Map<string, PreloadSandboxViolation>,
  violation: PreloadSandboxViolation | null
): void {
  if (violation) {
    violations.set(`${violation.kind}:${violation.detail}`, violation)
  }
}

export function findPreloadSandboxViolations(code: string): PreloadSandboxViolation[] {
  const violations = new Map<string, PreloadSandboxViolation>()
  for (const pattern of [LITERAL_MODULE_CALL_RE, STATIC_MODULE_SOURCE_RE]) {
    pattern.lastIndex = 0
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2]
      if (specifier !== undefined) {
        collect(violations, classifySpecifier(specifier))
      }
    }
  }
  NONLITERAL_MODULE_CALL_RE.lastIndex = 0
  for (const match of code.matchAll(NONLITERAL_MODULE_CALL_RE)) {
    collect(violations, {
      kind: 'nonliteral-module-request',
      detail: code
        .slice(match.index, match.index + match[0].length + 24)
        .split('\n')[0]
        .trim()
    })
  }
  return [...violations.values()].sort((left, right) =>
    `${left.kind}:${left.detail}`.localeCompare(`${right.kind}:${right.detail}`)
  )
}

function formatViolations(
  fileName: string,
  violations: readonly PreloadSandboxViolation[]
): string {
  const grouped = new Map<PreloadSandboxViolationKind, string[]>()
  for (const violation of violations) {
    grouped.set(violation.kind, [...(grouped.get(violation.kind) ?? []), violation.detail])
  }
  const parts = [...grouped].map(
    ([kind, details]) => `${VIOLATION_LABELS[kind]}: ${details.join(', ')}`
  )
  return (
    `[preload-sandbox-builtin-guard] "${fileName}" requests ${parts.join('; ')}. ` +
    `A sandboxed preload resolves only ${[...SANDBOX_SUPPORTED_EXTERNALS].join(', ')}; ` +
    'keep it browser-safe and do not polyfill Node modules.'
  )
}

export function assertPreloadSandboxBundleSafe(fileName: string, code: string): void {
  const violations = findPreloadSandboxViolations(code)
  if (violations.length > 0) {
    throw new Error(formatViolations(fileName, violations))
  }
}

/** Rollup's resolved import lists catch externals and shared chunks a source scan can miss. */
export function assertPreloadSandboxChunkSafe(chunk: OutputChunk): void {
  const violations = new Map<string, PreloadSandboxViolation>()
  for (const specifier of [...chunk.imports, ...chunk.dynamicImports]) {
    collect(violations, classifySpecifier(specifier))
  }
  for (const violation of findPreloadSandboxViolations(chunk.code)) {
    collect(violations, violation)
  }
  if (violations.size > 0) {
    throw new Error(formatViolations(chunk.fileName, [...violations.values()]))
  }
}

export function createPreloadSandboxBuiltinGuardPlugin(
  options?: Readonly<{
    /** Emitted file names to guard. Every chunk is guarded when omitted. */
    include?: readonly string[]
  }>
): Plugin {
  const include = options?.include ? new Set(options.include) : null
  return {
    name: 'orca-preload-sandbox-builtin-guard',
    // Why: generateBundle precedes the write, so no unsafe preload reaches out/ for a later
    // `pnpm start` or packaging step to pick up — including on watch rebuilds.
    generateBundle(_options: NormalizedOutputOptions, bundle: OutputBundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && (!include || include.has(item.fileName))) {
          assertPreloadSandboxChunkSafe(item)
        }
      }
      // Why: a renamed entry would otherwise silently leave the preload unguarded.
      const missing = include ? [...include].filter((fileName) => !(fileName in bundle)) : []
      if (missing.length > 0) {
        throw new Error(
          `[preload-sandbox-builtin-guard] guarded preload output missing from the bundle: ${missing.join(', ')}`
        )
      }
    }
  }
}
