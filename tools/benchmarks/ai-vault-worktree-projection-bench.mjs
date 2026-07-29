#!/usr/bin/env node
/**
 * Replays the AI Vault worktree projection — the work the CPU profile blamed
 * for the ~1s stall on workspace switch — against whatever source is checked
 * out right now.
 *
 * Bisecting through the real app costs ~6min/step (dev server boot on an 11GB
 * profile) and boots flakily. This runs the same hot functions over the same
 * real-scale inputs in a couple of seconds, so it can bisect ~500 commits.
 *
 * It compiles the checked-out .ts sources with esbuild rather than importing a
 * fixed copy, so each bisect step measures that commit's actual code.
 *
 *   node tools/benchmarks/ai-vault-worktree-projection-bench.mjs \
 *     --fixture /tmp/orca-bisect/fixture --budget 250
 *
 * Exit 0 = under budget, 1 = over, 125 = could not measure (skip).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

// --repo lets a bisect run this script from a fixed location against a
// worktree that is being checked out underneath it.
const REPO_ROOT = path.resolve(arg('repo', path.resolve(import.meta.dirname, '../..')))

const fixtureDir = arg('fixture', '/tmp/orca-bisect/fixture')
const budgetMs = Number(arg('budget', 250))
const iterations = Number(arg('iterations', 3))
const sessionCount = Number(arg('sessions', 500))

const HOT_MODULE = 'src/renderer/src/components/right-sidebar/ai-vault-session-worktree.ts'

let tempDir
try {
  const hotPath = path.join(REPO_ROOT, HOT_MODULE)
  readFileSync(hotPath) // throws on commits predating the module

  // Inside the repo, not tmpdir: the bundle keeps `react` external, so it has
  // to sit somewhere that can resolve the repo's node_modules.
  tempDir = mkdtempSync(path.join(REPO_ROOT, 'node_modules', '.aivault-bench-'))
  const bundlePath = path.join(tempDir, 'hot.mjs')

  // Bundle from the working tree so the measured code is this commit's code.
  // React is aliased to a stub rather than left external: esbuild turns an
  // external ESM import into `require()`, which an .mjs bundle cannot do. The
  // functions under test are pure data work and never call a hook.
  // CJS, so a Proxy can stand in for every named export transitive deps pull
  // from react (Fragment, createElement, Children, ...) without listing them.
  const shimPath = path.join(tempDir, 'react-shim.cjs')
  writeFileSync(
    shimPath,
    'const hooks = {\n' +
      '  useMemo: (fn) => fn(),\n' +
      '  useCallback: (fn) => fn,\n' +
      '  useRef: (v) => ({ current: v }),\n' +
      '  useState: (v) => [v, () => {}],\n' +
      '  useEffect: () => {},\n' +
      '  useLayoutEffect: () => {},\n' +
      '  createContext: () => ({ Provider: null, Consumer: null }),\n' +
      '  createElement: () => null,\n' +
      '  Fragment: null\n' +
      '}\n' +
      'module.exports = new Proxy(hooks, {\n' +
      '  get: (target, prop) => (prop in target ? target[prop] : () => null)\n' +
      '})\n'
  )

  execFileSync(
    path.join(REPO_ROOT, 'node_modules/.bin/esbuild'),
    [
      hotPath,
      '--bundle',
      '--format=esm',
      // node, not neutral: transitive deps (react-i18next -> html-parse-stringify)
      // only resolve with node main-field semantics.
      '--platform=node',
      '--log-level=silent',
      `--alias:react=${shimPath}`,
      `--outfile=${bundlePath}`
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] }
  )

  const hot = await import(pathToFileURL(bundlePath).href)
  const resolve = hot.resolveAiVaultSessionWorktreeDisplay ?? hot.resolveAiVaultSessionWorktreeInfo
  if (typeof resolve !== 'function') {
    throw new Error('no resolve export in this revision')
  }

  const worktrees = JSON.parse(readFileSync(path.join(fixtureDir, 'worktrees.json'), 'utf8'))
  const repos = JSON.parse(readFileSync(path.join(fixtureDir, 'repos.json'), 'utf8'))

  // Sessions live under real workspace paths so containment checks match the
  // way they do in the app; a synthetic path would short-circuit differently.
  const sessions = Array.from({ length: sessionCount }, (_, i) => {
    const wt = worktrees[(i * 7) % worktrees.length]
    return {
      id: `session-${i}`,
      cwd: i % 9 === 0 ? `${wt.path}/src/nested/dir` : wt.path,
      executionHostId: null,
      title: `session ${i}`
    }
  })

  const activeWorktreeId = worktrees[0]?.id ?? null

  const runOnce = () => {
    const t0 = performance.now()
    let resolved = 0
    for (const session of sessions) {
      const info = resolve({ session, repos, worktrees, activeWorktreeId })
      if (info) {
        resolved += 1
      }
    }
    return { ms: performance.now() - t0, resolved }
  }

  runOnce() // warm JIT
  const runs = Array.from({ length: iterations }, runOnce)
  const times = runs.map((r) => r.ms).sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]

  const report = {
    sha: execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8'
    }).trim(),
    worktrees: worktrees.length,
    repos: repos.length,
    sessions: sessions.length,
    resolved: runs[0].resolved,
    medianMs: +median.toFixed(1),
    minMs: +times[0].toFixed(1),
    maxMs: +times.at(-1).toFixed(1),
    budgetMs
  }
  report.pass = report.medianMs <= budgetMs

  console.log(JSON.stringify(report))
  process.exit(report.pass ? 0 : 1)
} catch (error) {
  console.error(`[bench] cannot measure: ${String(error?.message ?? error).slice(0, 200)}`)
  process.exit(125)
} finally {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
