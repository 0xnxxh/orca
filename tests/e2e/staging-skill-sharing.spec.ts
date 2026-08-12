import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import type { SkillBundleInstallResult } from '../../src/shared/skill-bundle-install-contract'
import type { SkillCloudPublishResult } from '../../src/shared/skill-cloud-contract'
import type {
  SkillBundleShareInstallOperation,
  SkillSharePreview
} from '../../src/shared/skill-sharing-contract'
import { expect, test } from './helpers/orca-app'

const RUN_STAGING = process.env.ORCA_E2E_SKILL_STAGING === '1'
const AUTH_TOKEN = process.env.ORCA_CLOUD_AUTH_TOKEN?.trim()
const SKILL_NAME = `orca-staging-${randomUUID().slice(0, 8)}`

if (RUN_STAGING && !AUTH_TOKEN) {
  throw new Error('ORCA_CLOUD_AUTH_TOKEN is required for the noninteractive staging journey.')
}

test.use({
  orcaAppExtraEnv: {
    ORCA_ARTIFACTS_API_URL: 'https://cloud-api-staging.onorca.dev',
    ORCA_CLOUD_API_URL: 'https://auth-staging.onorca.dev',
    ORCA_CLOUD_AUTH_URL: 'https://auth-staging.onorca.dev',
    ORCA_CLOUD_CLIENT_ID: 'orca-desktop',
    ...(AUTH_TOKEN ? { ORCA_CLOUD_AUTH_TOKEN: AUTH_TOKEN } : {})
  }
})

test.skip(!RUN_STAGING, 'Set ORCA_E2E_SKILL_STAGING=1 to run the live staging journey.')
test.describe.configure({ mode: 'serial' })

test('publishes, updates, revokes, and deletes without losing local state', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(12 * 60_000)
  const sourceRoot = mkdtempSync(join(tmpdir(), 'orca-staging-skill-source-'))
  const source = join(sourceRoot, '.agents', 'skills', SKILL_NAME)
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const globalSkill = join(home, '.agents', 'skills', SKILL_NAME)
  let packageId: string | null = null
  try {
    mkdirSync(source, { recursive: true })
    writeSkill(source, 'v1')
    const first = await publish(
      orcaPage,
      sourceRoot,
      'Initial staging journey',
      undefined,
      (preview) => {
        packageId = preview.packageId
      }
    )
    const firstInstall = await installVersion(orcaPage, first.published, { scope: 'global' })
    expectBundleOutcome(firstInstall, 'complete', 'installed')
    expect(readFileSync(join(globalSkill, 'SKILL.md'), 'utf8')).toContain('version: v1')

    writeSkill(globalSkill, 'local')
    writeSkill(source, 'v2')
    const second = await publish(
      orcaPage,
      sourceRoot,
      'Second immutable version',
      first.preview.packageId
    )
    const conflict = await installVersion(orcaPage, second.published, { scope: 'global' })
    expectBundleOutcome(conflict, 'partial', 'kept-local', 'modified')
    expect(readFileSync(join(globalSkill, 'SKILL.md'), 'utf8')).toContain('version: local')

    const update = await installVersion(
      orcaPage,
      second.published,
      { scope: 'global' },
      'replace-and-discard-local'
    )
    expectBundleOutcome(update, 'complete', 'updated')
    expect(readFileSync(join(globalSkill, 'SKILL.md'), 'utf8')).toContain('version: v2')

    const rollback = await installVersion(
      orcaPage,
      first.published,
      { scope: 'global' },
      'replace-unmodified'
    )
    expectBundleOutcome(rollback, 'complete', 'updated')
    expect(readFileSync(join(globalSkill, 'SKILL.md'), 'utf8')).toContain('version: v1')

    expect(
      await orcaPage.evaluate(
        (shareId) => window.api.skills.revokeShare(shareId),
        first.published.share.id
      )
    ).toMatchObject({ status: 'ok' })
    const revokedInstall = await orcaPage.evaluate(
      async ({ shareId, skillId }) => {
        try {
          return await window.api.skills.installBundleShare({
            shareId,
            selectedSkillIds: [skillId],
            destination: { scope: 'global' }
          })
        } catch {
          return { status: 'rejected' as const }
        }
      },
      { shareId: first.published.share.id, skillId: bundleSkillId(first.published) }
    )
    expect(revokedInstall.status).toBe('rejected')
    expect(readFileSync(join(globalSkill, 'SKILL.md'), 'utf8')).toContain('version: v1')

    const removed = await orcaPage.evaluate(
      (name) => window.api.skills.removeInstall({ name, destination: { scope: 'global' } }),
      SKILL_NAME
    )
    expect(removed).toMatchObject({ status: 'ok', value: { status: 'removed' } })
    expect(existsSync(globalSkill)).toBe(false)
    expect(
      await orcaPage.evaluate((id) => window.api.skills.getPackage(id), packageId)
    ).toMatchObject({ status: 'ok' })
    expect(
      await orcaPage.evaluate((id) => window.api.skills.deletePackage(id), packageId)
    ).toMatchObject({ status: 'ok' })
    packageId = null
  } finally {
    if (packageId) {
      await orcaPage
        .evaluate((id) => window.api.skills.deletePackage(id), packageId)
        .catch(() => undefined)
    }
    rmSync(globalSkill, { recursive: true, force: true })
    rmSync(sourceRoot, { recursive: true, force: true })
  }
})

function writeSkill(directory: string, version: string): void {
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${SKILL_NAME}\ndescription: Orca staging installation journey\n---\n\n# Staging journey\n\nversion: ${version}\n`
  )
}

async function publish(
  page: Page,
  cwd: string,
  releaseNotes: string,
  packageId?: string,
  onPrepared?: (preview: SkillSharePreview) => void
): Promise<{ preview: SkillSharePreview; published: SkillCloudPublishResult }> {
  const sourceDirectory = join(cwd, '.agents', 'skills', SKILL_NAME)
  const skill = await page.evaluate(
    async ({ cwd, sourceDirectory }) =>
      (await window.api.skills.discover({ cwd })).skills.find(
        (candidate) => candidate.directoryPath === sourceDirectory
      ),
    { cwd, sourceDirectory }
  )
  if (!skill) {
    throw new Error('staging skill source was not discovered')
  }
  const preview = await page.evaluate(
    ({ skillId, bundleName, cwd, packageId }) =>
      window.api.skills.prepareShare({
        skillIds: [skillId],
        bundleName,
        target: { cwd },
        ...(packageId ? { packageId } : {})
      }),
    { skillId: skill.id, bundleName: SKILL_NAME, cwd, packageId }
  )
  onPrepared?.(preview)
  const operation = await page.evaluate(
    ({ preparationId, releaseNotes }) =>
      window.api.skills.publishShare({ preparationId, releaseNotes }),
    { preparationId: preview.preparationId, releaseNotes }
  )
  expect(operation.status).toBe('ok')
  if (operation.status !== 'ok') {
    throw new Error(`staging publish failed: ${operation.status}`)
  }
  return { preview, published: operation.value }
}

function installVersion(
  page: Page,
  published: SkillCloudPublishResult,
  destination: { scope: 'global' },
  conflictResolution?: 'replace-unmodified' | 'replace-and-discard-local'
) {
  const skillId = bundleSkillId(published)
  return page.evaluate(
    ({ packageId, versionId, skillId, destination, conflictResolution }) =>
      window.api.skills.installBundlePackageVersion({
        packageId,
        versionId,
        selectedSkillIds: [skillId],
        destination,
        ...(conflictResolution
          ? { conflictDecisions: [{ skillId, resolution: conflictResolution }] }
          : {})
      }),
    {
      packageId: published.version.packageId,
      versionId: published.version.versionId,
      skillId,
      destination,
      conflictResolution
    }
  )
}

function bundleSkillId(published: SkillCloudPublishResult): string {
  const manifest = published.version.manifest
  if (!('skills' in manifest) || manifest.skills.length !== 1) {
    throw new Error('staging publish did not return the expected one-skill bundle')
  }
  return manifest.skills[0].id
}

function expectBundleOutcome(
  operation: SkillBundleShareInstallOperation,
  expectedStatus: SkillBundleInstallResult['status'],
  expectedSkillStatus: SkillBundleInstallResult['skills'][number]['status'],
  expectedConflict?: NonNullable<SkillBundleInstallResult['skills'][number]['conflict']>['kind']
): void {
  if (operation.status !== 'ok') {
    throw new Error(`staging bundle install operation failed: ${operation.status}`)
  }
  const diagnostic = JSON.stringify({
    status: operation.value.status,
    skills: operation.value.skills.map((skill) => ({
      status: skill.status,
      errorCategory: skill.errorCategory,
      failure: skill.failure,
      conflict: skill.conflict?.kind
    }))
  })
  expect(operation.value.status, diagnostic).toBe(expectedStatus)
  expect(operation.value.skills, diagnostic).toHaveLength(1)
  expect(operation.value.skills[0]?.status, diagnostic).toBe(expectedSkillStatus)
  expect(operation.value.skills[0]?.conflict?.kind, diagnostic).toBe(expectedConflict)
}
