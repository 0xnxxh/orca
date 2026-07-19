const { existsSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

function assertPackagedMacUpdateMonitorExists(resourcesDir) {
  const entryPath = join(
    resourcesDir,
    'app.asar.unpacked',
    'out',
    'main',
    'mac-update-install-fence-monitor.js'
  )
  if (!existsSync(entryPath)) {
    throw new Error(
      `[verify-packaged-mac-update-monitor] missing unpacked monitor entry at ${entryPath}`
    )
  }
  return entryPath
}

function verifyPackagedMacUpdateMonitorBoots(resourcesDir, options = {}) {
  const entryPath = assertPackagedMacUpdateMonitorExists(resourcesDir)
  const result = spawnSync(options.execPath || process.execPath, [entryPath], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (result.error) {
    throw new Error(
      `[verify-packaged-mac-update-monitor] could not launch monitor: ${result.error.message}`
    )
  }
  const stderr = result.stderr || ''
  if (/Cannot find module|MODULE_NOT_FOUND/.test(stderr)) {
    throw new Error(
      `[verify-packaged-mac-update-monitor] packaged monitor failed to load:\n${stderr}`
    )
  }
  if (!stderr.includes('Usage: mac-update-install-fence-monitor')) {
    throw new Error(
      '[verify-packaged-mac-update-monitor] monitor did not reach plain-Node argv parsing'
    )
  }
}

module.exports = {
  assertPackagedMacUpdateMonitorExists,
  verifyPackagedMacUpdateMonitorBoots
}
