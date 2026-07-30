import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const TOP_CONTRIBUTOR_COUNT = 10
const RENDERER_ENTRIES = [
  { id: 'renderer-index', manifestKey: 'index.html' },
  { id: 'renderer-popout', manifestKey: 'popout.html' },
  { id: 'renderer-web', manifestKey: 'web-index.html' }
]

function displayPath(filePath) {
  return filePath.split(sep).join('/')
}

function readArtifact(projectRoot, projectPath) {
  const absolutePath = join(projectRoot, ...projectPath.split('/'))

  try {
    return readFileSync(absolutePath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing build artifact: ${projectPath}`)
    }
    throw error
  }
}

function resolveRendererArtifact(projectRoot, manifestPath) {
  if (
    isAbsolute(manifestPath) ||
    /^[A-Za-z]:[\\/]/.test(manifestPath) ||
    manifestPath.split(/[\\/]/).includes('..')
  ) {
    throw new Error(`Invalid renderer artifact path: ${manifestPath}`)
  }

  const rendererRoot = join(projectRoot, 'out', 'renderer')
  const absolutePath = resolve(rendererRoot, ...manifestPath.split('/'))
  const relativePath = relative(projectRoot, absolutePath)
  return {
    absolutePath,
    reportPath: displayPath(relativePath)
  }
}

function measureFile(buffer, reportPath, type) {
  return {
    path: reportPath,
    type,
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer).byteLength
  }
}

function comparePaths(left, right) {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

function summarizeEntry(id, entryFile, files) {
  const contributors = [...files].sort(
    (left, right) => right.rawBytes - left.rawBytes || comparePaths(left.path, right.path)
  )

  return {
    id,
    entryFile,
    rawBytes: contributors.reduce((total, file) => total + file.rawBytes, 0),
    gzipBytes: contributors.reduce((total, file) => total + file.gzipBytes, 0),
    javascriptFiles: contributors.filter((file) => file.type === 'javascript').length,
    cssFiles: contributors.filter((file) => file.type === 'css').length,
    topContributors: contributors.slice(0, TOP_CONTRIBUTOR_COUNT)
  }
}

function collectRendererFiles(manifest, entryKey) {
  const visitedChunks = new Set()
  const javascriptFiles = new Set()
  const cssFiles = new Set()

  function visit(chunkKey) {
    if (visitedChunks.has(chunkKey)) {
      return
    }
    visitedChunks.add(chunkKey)

    const chunk = manifest[chunkKey]
    if (!chunk) {
      throw new Error(`Missing manifest chunk "${chunkKey}" reached from "${entryKey}"`)
    }
    if (typeof chunk.file !== 'string') {
      throw new Error(`Manifest chunk "${chunkKey}" has no output file`)
    }

    javascriptFiles.add(chunk.file)
    for (const cssFile of chunk.css ?? []) {
      cssFiles.add(cssFile)
    }
    for (const importedChunk of chunk.imports ?? []) {
      visit(importedChunk)
    }
  }

  visit(entryKey)
  return { javascriptFiles, cssFiles }
}

function readRendererArtifact(absolutePath, reportPath) {
  try {
    return readFileSync(absolutePath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing build artifact: ${reportPath}`)
    }
    throw error
  }
}

function measureRendererEntry(projectRoot, manifest, { id, manifestKey }) {
  const { javascriptFiles, cssFiles } = collectRendererFiles(manifest, manifestKey)
  const files = []

  for (const manifestPath of [...javascriptFiles].sort()) {
    const { absolutePath, reportPath } = resolveRendererArtifact(projectRoot, manifestPath)
    files.push(
      measureFile(readRendererArtifact(absolutePath, reportPath), reportPath, 'javascript')
    )
  }
  for (const manifestPath of [...cssFiles].sort()) {
    const { absolutePath, reportPath } = resolveRendererArtifact(projectRoot, manifestPath)
    files.push(measureFile(readRendererArtifact(absolutePath, reportPath), reportPath, 'css'))
  }

  return summarizeEntry(id, manifestKey, files)
}

export function createElectronBundleEntryReport(projectRoot = process.cwd()) {
  projectRoot = resolve(projectRoot)
  const manifestPath = 'out/renderer/.vite/manifest.json'
  const manifestBuffer = readArtifact(projectRoot, manifestPath)
  let manifest

  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'))
  } catch {
    throw new Error(`Invalid JSON build artifact: ${manifestPath}`)
  }

  const singleFileEntries = [
    { id: 'electron-main', path: 'out/main/index.js' },
    { id: 'electron-preload', path: 'out/preload/index.js' }
  ].map(({ id, path }) =>
    summarizeEntry(id, path, [measureFile(readArtifact(projectRoot, path), path, 'javascript')])
  )

  return {
    version: 1,
    entries: [
      ...singleFileEntries,
      ...RENDERER_ENTRIES.map((entry) => measureRendererEntry(projectRoot, manifest, entry))
    ]
  }
}

export function findElectronBundleBudgetFailures(report, budgets) {
  const failures = []

  for (const entry of report.entries) {
    const budget = budgets.entries?.[entry.id]
    if (!budget) {
      failures.push(`${entry.id}: missing checked-in budget`)
      continue
    }

    const checks = [
      ['raw bytes', entry.rawBytes, budget.maxRawBytes],
      ['JavaScript files', entry.javascriptFiles, budget.maxJavaScriptFiles],
      ['CSS files', entry.cssFiles, budget.maxCssFiles]
    ]
    for (const [label, actual, limit] of checks) {
      if (!Number.isSafeInteger(limit) || limit < 0) {
        failures.push(`${entry.id}: invalid ${label} budget`)
      } else if (actual > limit) {
        failures.push(`${entry.id}: ${label} ${actual} exceeds budget ${limit}`)
      }
    }
  }

  return failures
}

export function runElectronBundleBudgetCheck({
  projectRoot = process.cwd(),
  budgetsPath = join(projectRoot, 'config', 'electron-bundle-budgets.json'),
  writeReport = console.log,
  writeError = console.error
} = {}) {
  try {
    const report = createElectronBundleEntryReport(projectRoot)
    const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'))
    const failures = findElectronBundleBudgetFailures(report, budgets)
    writeReport(JSON.stringify(report, null, 2))
    for (const failure of failures) {
      writeError(`Bundle budget exceeded: ${failure}`)
    }
    return failures.length === 0 ? 0 : 1
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  process.exitCode = runElectronBundleBudgetCheck()
}
