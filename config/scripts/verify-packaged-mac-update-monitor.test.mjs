import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  assertPackagedMacUpdateMonitorExists,
  verifyPackagedMacUpdateMonitorBoots
} = require('./verify-packaged-mac-update-monitor.cjs')

describe('packaged mac update monitor verification', () => {
  it('requires the unpacked entry and smoke-loads its module graph', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-monitor-'))
    const entryPath = join(
      resourcesDir,
      'app.asar.unpacked',
      'out',
      'main',
      'mac-update-install-fence-monitor.js'
    )
    try {
      expect(() => assertPackagedMacUpdateMonitorExists(resourcesDir)).toThrow('missing unpacked')
      await mkdir(dirname(entryPath), { recursive: true })
      await writeFile(
        entryPath,
        "process.stderr.write('Usage: mac-update-install-fence-monitor\\n')",
        'utf8'
      )
      expect(() => verifyPackagedMacUpdateMonitorBoots(resourcesDir)).not.toThrow()
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})
