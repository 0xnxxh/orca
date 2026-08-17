import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: `wsl.exe <...> -- <argv>` expands $name in every argument against the guest
// environment before the guest runs, silently rewriting scripts (an `awk '{print $2}'`
// loses its field reference). `--exec` passes argv through untouched. Nothing may
// reintroduce the `--` mode separator, so guard the whole tree instead of each call site.
const WSL_SHELL_AFTER_DASH_DASH = /'--',\s*'(?:sh|bash)'/

function collectSourceFiles(root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full))
      continue
    }
    if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      found.push(full)
    }
  }
  return found
}

describe('wsl.exe mode separator', () => {
  it('never hands the guest shell to wsl.exe through `--`', () => {
    const srcRoot = resolve(__dirname, '..')
    const offenders = collectSourceFiles(srcRoot).filter((file) =>
      WSL_SHELL_AFTER_DASH_DASH.test(readFileSync(file, 'utf8'))
    )

    expect(offenders).toEqual([])
  })
})
