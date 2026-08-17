import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: `wsl.exe <...> -- <argv>` expands $name in every argument against the guest
// environment before the guest runs, silently rewriting scripts (an `awk '{print $2}'`
// loses its field reference). `--exec` passes argv through untouched. Nothing may
// reintroduce the `--` mode separator, so guard the tree instead of each call site.
//
// Two spellings reach wsl.exe, and both have shipped a regression: an argv array, and
// a command line built as a string (PowerShell setup commands). Comments describing
// the old form are allowed — only code is scanned.
const ARGV_FORM = /'--',\s*'(?:\/[\w./-]+\/)?(?:sh|bash|zsh|dash|ash|ksh|mksh|env)'/
const STRING_FORM = /wsl(?:\.exe)?\b[^\n]*?[^-]--\s+(?:sh|bash|zsh|dash|env)\b/

const SCANNED_ROOTS = ['src', 'config', 'tests']
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'out', 'build', '.git'])

function collectSourceFiles(root: string): string[] {
  let found: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry)) {
      continue
    }
    const full = join(root, entry)
    if (statSync(full).isDirectory()) {
      found = found.concat(collectSourceFiles(full))
      continue
    }
    if (SCANNED_EXTENSIONS.some((extension) => full.endsWith(extension))) {
      found.push(full)
    }
  }
  return found
}

/** Drop comment-only lines so prose about the old `--` form does not trip the guard. */
function codeLines(contents: string): string[] {
  return contents
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
}

describe('wsl.exe mode separator', () => {
  const repoRoot = resolve(__dirname, '..', '..')
  const files = SCANNED_ROOTS.flatMap((root) => collectSourceFiles(join(repoRoot, root)))

  it('scans a plausible number of files', () => {
    // A broken root or extension list would make the guard silently vacuous.
    expect(files.length).toBeGreaterThan(500)
  })

  it.each([
    ['argv array', ARGV_FORM],
    ['command string', STRING_FORM]
  ])('never hands the guest shell to wsl.exe through `--` (%s)', (_form, pattern) => {
    const offenders = files.filter((file) =>
      codeLines(readFileSync(file, 'utf8')).some((line) => pattern.test(line))
    )

    expect(offenders.map((file) => relative(repoRoot, file))).toEqual([])
  })
})
