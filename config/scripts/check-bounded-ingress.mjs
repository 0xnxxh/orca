// Ratchet: unbounded reads of untrusted/unpredictable input are the OOM crash class (#9872, #9984).
// Existing occurrences are frozen in a baseline; new ones must use a src/shared/memory-safety helper
// or carry a `bounded-by:` justification comment on the line or the line above.
//
// Run: node config/scripts/check-bounded-ingress.mjs [--update-baseline]
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const SKIP_PATH_PARTS = new Set([
  'node_modules',
  'dist',
  'out',
  '.git',
  '__snapshots__',
  'memory-safety'
])
const BASELINE_PATH = 'config/bounded-ingress-baseline.json'

// Each pattern names an unbounded way to pull data into memory. Hints must name real exports —
// they are the text an agent copies when the ratchet blocks it (asserted in the test).
export const PATTERNS = [
  {
    id: 'read-file',
    re: /\breadFile(?:Sync)?\s*\(/,
    hint: 'use readNodeFileWithinLimit (memory-safety/node-bounded-file-reader)'
  },
  {
    id: 'response-text',
    re: /\.(?:text|json|arrayBuffer|blob)\s*\(\s*\)/,
    hint: 'bound the response body before materializing it'
  },
  {
    id: 'json-parse',
    re: /\bJSON\.parse\s*\(/,
    hint: 'guard with assertJsonTextStructureWithinLimits (memory-safety/json-text-structure-limit)'
  },
  {
    id: 'json-stringify',
    re: /\bJSON\.stringify\s*\(/,
    hint: 'use stringifyJsonWithinByteLimit (memory-safety/node-bounded-json-stringify) when the value can be large'
  },
  {
    id: 'unbounded-fanout',
    // Why two lines joined: the formatter wraps `Promise.all(\n  items.map(` far more often than it
    // keeps it on one, so a single-line regex misses the majority of real fan-outs.
    re: /Promise\.(?:all|allSettled|any)\s*\(\s*[\w.[\]]+\s*\.map\s*\(/,
    joinsNextLine: true,
    hint: 'use mapWithConcurrency so fan-out cannot grow with input size'
  }
]

// Why a non-empty rationale: an escape that costs nothing gets pattern-matched into place. Anchor to
// a comment so a string literal containing the token cannot silence a real finding.
const ALLOW_RE = /(?:\/\/|\/\*|\*)[^\n]*bounded-by:\s*\S/i

export function findViolations(relativePath, source) {
  const lines = source.split('\n')
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (ALLOW_RE.test(line) || (i > 0 && ALLOW_RE.test(lines[i - 1]))) {
      continue
    }
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1].trim()}` : line
    for (const pattern of PATTERNS) {
      if (!pattern.joinsNextLine) {
        if (pattern.re.test(line)) {
          found.push({ file: relativePath, line: i + 1, id: pattern.id, hint: pattern.hint })
        }
        continue
      }
      // Report the wrapped form once, at the line that opens it.
      if (
        pattern.re.test(joined) &&
        !(i > 0 && pattern.re.test(`${lines[i - 1]} ${line.trim()}`))
      ) {
        found.push({ file: relativePath, line: i + 1, id: pattern.id, hint: pattern.hint })
      }
    }
  }
  return found
}

export function violationKey(violation) {
  return `${violation.file}:${violation.id}`
}

function isSkipped(relative) {
  if (relative.includes('.test.') || relative.includes('.spec.') || relative.includes('.bench.')) {
    return true
  }
  // Why: generated output is gitignored, so scanning it makes the baseline depend on whether the
  // person regenerating it happens to have build artifacts present.
  if (relative.includes('.generated.')) {
    return true
  }
  return relative.split('/').some((part) => SKIP_PATH_PARTS.has(part))
}

async function collect(root, dir, out = []) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const relative = path.relative(root, full).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (!SKIP_PATH_PARTS.has(entry.name)) {
        await collect(root, full, out)
      }
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !isSkipped(relative)
    ) {
      out.push({ full, relative })
    }
  }
  return out
}

export async function run(root, { updateBaseline = false } = {}) {
  const files = [
    ...(await collect(root, path.join(root, 'src'))),
    ...(await collect(root, path.join(root, 'mobile/src')))
  ]
  const violations = []
  for (const file of files) {
    const source = await fs.readFile(file.full, 'utf8')
    violations.push(...findViolations(file.relative, source))
  }

  // Why counts, not just keys: a file:rule key alone lets an already-baselined file add a SECOND
  // unbounded read of the same kind silently — and follow-on work mostly touches baselined files.
  const counts = {}
  for (const v of violations) {
    const key = violationKey(v)
    counts[key] = (counts[key] ?? 0) + 1
  }

  const baselineFile = path.join(root, BASELINE_PATH)
  if (updateBaseline) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)))
    await fs.writeFile(baselineFile, `${JSON.stringify({ allowed: sorted }, null, 2)}\n`)
    return { added: [], baselineSize: Object.keys(sorted).length, updated: true }
  }

  let allowed = {}
  try {
    const parsed = JSON.parse(await fs.readFile(baselineFile, 'utf8')).allowed
    // Tolerate the original array form so the baseline can be regenerated, not hand-migrated.
    allowed = Array.isArray(parsed)
      ? Object.fromEntries(parsed.map((k) => [k, Number.POSITIVE_INFINITY]))
      : (parsed ?? {})
  } catch {
    // No baseline yet: every occurrence is reported so the first run can seed one.
  }

  const overBudget = new Set(Object.keys(counts).filter((key) => counts[key] > (allowed[key] ?? 0)))
  const seen = new Set()
  const added = violations.filter((v) => {
    const key = violationKey(v)
    if (!overBudget.has(key) || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  return { added, baselineSize: Object.keys(allowed).length, updated: false }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const root = path.resolve(import.meta.dirname, '../..')
  const updateBaseline = process.argv.includes('--update-baseline')
  const { added, baselineSize, updated } = await run(root, { updateBaseline })
  if (updated) {
    console.log(`bounded-ingress baseline updated (${baselineSize} allowed entries)`)
    process.exit(0)
  }
  if (added.length > 0) {
    console.error('Unbounded ingress introduced in files not covered by the baseline:\n')
    for (const v of added.slice(0, 40)) {
      console.error(`  ${v.file}:${v.line}  [${v.id}]\n      ${v.hint}`)
    }
    if (added.length > 40) {
      console.error(`  ... and ${added.length - 40} more`)
    }
    console.error(
      '\nSee src/shared/memory-safety/README.md. If the size is genuinely bounded already,' +
        ' add a `bounded-by:` comment on or above the line explaining what bounds it.'
    )
    process.exit(1)
  }
  console.log(`bounded-ingress: no new unbounded reads (${baselineSize} baseline entries)`)
}
