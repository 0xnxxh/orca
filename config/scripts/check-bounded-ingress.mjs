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

// Each pattern names an unbounded way to pull data into memory.
const PATTERNS = [
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
    hint: 'guard with assertJsonTextWithinStructureLimits (memory-safety/json-text-structure-limit)'
  },
  {
    id: 'json-stringify',
    re: /\bJSON\.stringify\s*\(/,
    hint: 'use stringifyJsonWithinLimit (memory-safety/node-bounded-json-stringify) when the value can be large'
  },
  {
    id: 'unbounded-fanout',
    re: /Promise\.all\s*\(\s*[\w.]+\s*\.map\s*\(/,
    hint: 'use mapWithConcurrency so fan-out cannot grow with input size'
  }
]

const ALLOW_RE = /bounded-by:/i

export function findViolations(relativePath, source) {
  const lines = source.split('\n')
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (ALLOW_RE.test(line) || (i > 0 && ALLOW_RE.test(lines[i - 1]))) {
      continue
    }
    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
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

  const baselineFile = path.join(root, BASELINE_PATH)
  if (updateBaseline) {
    const keys = [...new Set(violations.map(violationKey))].sort()
    await fs.writeFile(baselineFile, `${JSON.stringify({ allowed: keys }, null, 2)}\n`)
    return { added: [], baselineSize: keys.length, updated: true }
  }

  let allowed = new Set()
  try {
    allowed = new Set(JSON.parse(await fs.readFile(baselineFile, 'utf8')).allowed)
  } catch {
    // No baseline yet: every occurrence is reported so the first run can seed one.
  }
  const added = violations.filter((v) => !allowed.has(violationKey(v)))
  return { added, baselineSize: allowed.size, updated: false }
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
