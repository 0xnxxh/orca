import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createElectronBundleEntryReport,
  findElectronBundleBudgetFailures,
  runElectronBundleBudgetCheck
} from './electron-bundle-entry-report.mjs'

let projectRoot

async function writeProjectFile(projectPath, contents) {
  const absolutePath = join(projectRoot, ...projectPath.split('/'))
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents)
}

async function writeFixtureBuild() {
  const files = {
    'out/main/index.js': 'main-entry',
    'out/preload/index.js': 'preload-entry',
    'out/renderer/assets/index.js': 'index-entry',
    'out/renderer/assets/first.js': 'first-chunk',
    'out/renderer/assets/shared.js': 'shared-chunk',
    'out/renderer/assets/popout.js': 'popout-entry',
    'out/renderer/assets/web.js': 'web-entry',
    'out/renderer/assets/index.css': 'index-style',
    'out/renderer/assets/shared.css': 'shared-style'
  }
  const manifest = {
    'index.html': {
      file: 'assets/index.js',
      imports: ['_first.js', '_shared.js'],
      dynamicImports: ['_dynamic.js'],
      css: ['assets/index.css']
    },
    '_first.js': {
      file: 'assets/first.js',
      imports: ['_shared.js'],
      css: ['assets/shared.css']
    },
    '_shared.js': {
      file: 'assets/shared.js',
      css: ['assets/shared.css']
    },
    'popout.html': {
      file: 'assets/popout.js',
      imports: ['_shared.js']
    },
    'web-index.html': {
      file: 'assets/web.js',
      imports: ['_shared.js']
    },
    '_dynamic.js': {
      file: 'assets/not-written-dynamic.js'
    }
  }

  for (const [projectPath, contents] of Object.entries(files)) {
    await writeProjectFile(projectPath, contents)
  }
  await writeProjectFile('out/renderer/.vite/manifest.json', JSON.stringify(manifest))
  return files
}

function byteLength(value) {
  return Buffer.byteLength(value)
}

function gzipLength(value) {
  return gzipSync(value).byteLength
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'orca-electron-bundle-report-'))
})

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true })
})

describe('Electron bundle entry report', () => {
  it('follows transitive static imports and ignores dynamic imports', async () => {
    const files = await writeFixtureBuild()
    const report = createElectronBundleEntryReport(projectRoot)
    const entry = report.entries.find(({ id }) => id === 'renderer-index')
    const expectedPaths = [
      'out/renderer/assets/index.js',
      'out/renderer/assets/first.js',
      'out/renderer/assets/shared.js',
      'out/renderer/assets/index.css',
      'out/renderer/assets/shared.css'
    ]

    expect(entry.javascriptFiles).toBe(3)
    expect(entry.cssFiles).toBe(2)
    expect(entry.rawBytes).toBe(
      expectedPaths.reduce((total, projectPath) => total + byteLength(files[projectPath]), 0)
    )
    expect(entry.gzipBytes).toBe(
      expectedPaths.reduce((total, projectPath) => total + gzipLength(files[projectPath]), 0)
    )
  })

  it('deduplicates shared JavaScript and CSS within each entry', async () => {
    await writeFixtureBuild()
    const report = createElectronBundleEntryReport(projectRoot)
    const entry = report.entries.find(({ id }) => id === 'renderer-index')
    const paths = entry.topContributors.map(({ path }) => path)

    expect(paths.filter((path) => path.endsWith('shared.js'))).toHaveLength(1)
    expect(paths.filter((path) => path.endsWith('shared.css'))).toHaveLength(1)
  })

  it('fails clearly when a referenced production artifact is missing', async () => {
    await writeFixtureBuild()
    await unlink(join(projectRoot, 'out', 'renderer', 'assets', 'shared.js'))

    expect(() => createElectronBundleEntryReport(projectRoot)).toThrow(/shared\.js/)
  })

  it('reports raw-size and chunk-count budget failures', async () => {
    await writeFixtureBuild()
    const report = createElectronBundleEntryReport(projectRoot)
    const budgets = {
      entries: Object.fromEntries(
        report.entries.map((entry) => [
          entry.id,
          {
            maxRawBytes: entry.rawBytes,
            maxJavaScriptFiles: entry.javascriptFiles,
            maxCssFiles: entry.cssFiles
          }
        ])
      )
    }
    budgets.entries['renderer-index'].maxRawBytes -= 1
    budgets.entries['renderer-index'].maxJavaScriptFiles -= 1

    expect(findElectronBundleBudgetFailures(report, budgets)).toEqual([
      expect.stringContaining('raw bytes'),
      expect.stringContaining('JavaScript files')
    ])
  })

  it('returns a nonzero gate result when a checked-in budget is exceeded', async () => {
    await writeFixtureBuild()
    const budgetsPath = join(projectRoot, 'budgets.json')
    const report = createElectronBundleEntryReport(projectRoot)
    const budgets = {
      entries: Object.fromEntries(
        report.entries.map((entry) => [
          entry.id,
          {
            maxRawBytes: entry.id === 'electron-main' ? 0 : entry.rawBytes,
            maxJavaScriptFiles: entry.javascriptFiles,
            maxCssFiles: entry.cssFiles
          }
        ])
      )
    }
    const errors = []
    await writeFile(budgetsPath, JSON.stringify(budgets))

    expect(
      runElectronBundleBudgetCheck({
        projectRoot,
        budgetsPath,
        writeReport: () => {},
        writeError: (message) => errors.push(message)
      })
    ).toBe(1)
    expect(errors).toEqual([expect.stringContaining('electron-main')])
  })
})
