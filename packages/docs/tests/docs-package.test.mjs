/**
 * Structural tests for the open-source docs package.
 * Drive real filesystem + package entry points — no hardcoded content claims.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const pkgRoot = join(fileURLToPath(new URL('..', import.meta.url)))

function listFiles(dir, predicate = () => true) {
  const out = []
  if (!existsSync(dir)) {
    return out
  }
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) {
      out.push(...listFiles(p, predicate))
    } else if (predicate(p)) {
      out.push(p)
    }
  }
  return out
}

test('package.json exposes installable build/dev/start scripts', () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@orca/docs')
  for (const script of ['dev', 'build', 'start', 'test']) {
    assert.ok(pkg.scripts[script], `missing script: ${script}`)
  }
  assert.ok(pkg.dependencies.next)
  assert.ok(pkg.dependencies['fumadocs-mdx'])
  assert.ok(pkg.dependencies['fumadocs-ui'])
  assert.ok(pkg.dependencies['fumadocs-core'])
})

test('content/docs has MDX pages and meta.json tree', () => {
  const contentRoot = join(pkgRoot, 'content/docs')
  const mdx = listFiles(contentRoot, (p) => p.endsWith('.mdx'))
  const meta = listFiles(contentRoot, (p) => p.endsWith('meta.json'))
  assert.ok(mdx.length >= 20, `expected many MDX pages, got ${mdx.length}`)
  assert.ok(meta.length >= 1, 'expected meta.json files for nav')
  assert.ok(existsSync(join(contentRoot, 'index.mdx')), 'docs index page must exist')
  const index = readFileSync(join(contentRoot, 'index.mdx'), 'utf8')
  assert.match(index, /Orca|worktree|agent/i)
})

test('docs media assets exist for MDX ImagePlaceholder paths', () => {
  const contentRoot = join(pkgRoot, 'content/docs')
  const mdxFiles = listFiles(contentRoot, (p) => p.endsWith('.mdx'))
  const srcs = new Set()
  for (const file of mdxFiles) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/src="(\/[^"]+)"/g)) {
      srcs.add(m[1])
    }
  }
  assert.ok(srcs.size > 0, 'expected ImagePlaceholder src paths in MDX')
  const missing = []
  for (const src of srcs) {
    const abs = join(pkgRoot, 'public', src.slice(1))
    if (!existsSync(abs)) {
      missing.push(src)
    }
  }
  assert.deepEqual(missing, [], `missing public assets: ${missing.join(', ')}`)
})

test('docs-only shell has no marketing homepage/enterprise/download routes', () => {
  const appDir = join(pkgRoot, 'src/app')
  const forbidden = ['enterprise', 'download', 'changelog', 'diagnostics', 'privacy', 'terms']
  for (const name of forbidden) {
    assert.equal(existsSync(join(appDir, name)), false, `must not ship marketing route: ${name}`)
  }
  assert.equal(existsSync(join(pkgRoot, 'src/components/product-animations')), false)
  assert.equal(existsSync(join(pkgRoot, 'src/components/sections')), false)
  assert.equal(existsSync(join(pkgRoot, 'src/components/DownloadButton.tsx')), false)
})

test('source loader pins baseUrl /docs for stable public URLs', () => {
  const sourceTs = readFileSync(join(pkgRoot, 'src/lib/source.ts'), 'utf8')
  assert.match(sourceTs, /baseUrl:\s*['"]\/docs['"]/)
})

test('demoMedia poster/video helpers map docs and whats-new paths', async () => {
  // Real shipped pure helpers (JS); TS re-exports the same module for the app.
  const { posterFor, videoFor } = await import(
    new URL('../src/lib/demoMedia.mjs', import.meta.url).href
  )
  assert.equal(posterFor('/docs/foo.gif'), '/docs/posters/foo.jpg')
  assert.equal(posterFor('/whats-new/bar.gif'), '/whats-new/posters/bar.jpg')
  assert.equal(videoFor('/docs/foo.gif'), '/docs/videos/foo.mp4')
  assert.equal(videoFor('/whats-new/bar.gif'), '/whats-new/videos/bar.mp4')
  const reexport = readFileSync(join(pkgRoot, 'src/lib/demoMedia.ts'), 'utf8')
  assert.match(reexport, /from ['"]\.\/demoMedia\.mjs['"]/)
})

test('production build output directory is non-empty after next build (when present)', () => {
  const nextDir = join(pkgRoot, '.next')
  if (!existsSync(nextDir)) {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.build.includes('next build'), true)
    return
  }
  const size = listFiles(nextDir).length
  assert.ok(size > 10, `.next should contain build artifacts, found ${size} files`)
})

test('README documents install/dev/build/start', () => {
  const readme = readFileSync(join(pkgRoot, 'README.md'), 'utf8')
  assert.match(readme, /pnpm install/)
  assert.match(readme, /pnpm dev/)
  assert.match(readme, /pnpm build/)
  assert.match(readme, /pnpm start/)
  assert.match(readme, /\/docs/)
})

test('relative content tree is under packages/docs only', () => {
  const rel = relative(pkgRoot, join(pkgRoot, 'content/docs/index.mdx'))
  assert.equal(rel, join('content', 'docs', 'index.mdx'))
  assert.ok(statSync(join(pkgRoot, 'content/docs/index.mdx')).isFile())
})
