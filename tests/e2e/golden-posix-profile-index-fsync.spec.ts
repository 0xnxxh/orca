import { rmSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'

test.use({ seedTestRepo: false })
test.skip(process.platform === 'win32', 'Restrictive-umask fsync regression is POSIX-only')

test('loads a fresh profile index with a restrictive umask @posix-profile-index-golden', async ({
  electronApp,
  orcaPage
}) => {
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const originalUmask = await electronApp.evaluate(() => process.umask(0o200))

  try {
    rmSync(path.join(userDataDir, 'orca-profile-index.json'), { force: true })
    rmSync(path.join(userDataDir, 'orca-profile-index.json.bak'), { force: true })
    await orcaPage.evaluate(async () => {
      const result = await window.api.orcaProfiles.list()
      if (result.profiles.length === 0) {
        throw new Error('fresh profile index did not persist')
      }
      window.__store!.getState().openSettingsPage()
    })
  } finally {
    await electronApp.evaluate((_electron, umask) => process.umask(umask), originalUmask)
  }

  await expect(orcaPage.getByPlaceholder('Search settings')).toBeVisible()
})
