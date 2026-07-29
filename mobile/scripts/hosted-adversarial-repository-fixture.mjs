import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const fixturePrefix = 'orca-mobile-adversarial.'
export const HOSTED_ADVERSARIAL_FILENAME_MARKER = 'ORCA_ADVERSARIAL_FILENAME'
export const HOSTED_ADVERSARIAL_CONTENT_MARKER = 'ORCA_ADVERSARIAL_CONTENT'
export const HOSTED_ADVERSARIAL_WORKSPACE_ROW = 'orca-adversarial-row'
export const HOSTED_ADVERSARIAL_FILENAME = `000-<img src=x onerror=globalThis.${HOSTED_ADVERSARIAL_FILENAME_MARKER}=1>.tsx`
export const HOSTED_ADVERSARIAL_CONTENT = `<img src=x onerror="globalThis.${HOSTED_ADVERSARIAL_CONTENT_MARKER}=1">`

export async function createHostedAdversarialRepositoryFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), fixturePrefix)))
  try {
    await git(root, ['init', '-q'])
    await git(root, ['config', 'user.name', 'Orca Mobile Test'])
    await git(root, ['config', 'user.email', 'mobile-test@orca.invalid'])
    await writeFile(path.join(root, 'README.md'), 'Adversarial mobile fixture\n')
    const blobSource = path.join(root, '.orca-adversarial-content')
    await writeFile(blobSource, `${HOSTED_ADVERSARIAL_CONTENT}\n`)
    const blob = await git(root, ['hash-object', '-w', blobSource])
    await rm(blobSource)
    await git(root, ['add', 'README.md'])
    await git(root, [
      'update-index',
      '--add',
      '--cacheinfo',
      '100644',
      blob,
      HOSTED_ADVERSARIAL_FILENAME
    ])
    await git(root, ['commit', '-q', '-m', 'Initial fixture'])
    await git(root, ['branch', '-m', HOSTED_ADVERSARIAL_WORKSPACE_ROW])
    return {
      root,
      workspaceName: path.basename(root),
      workspaceRowName: HOSTED_ADVERSARIAL_WORKSPACE_ROW,
      filename: HOSTED_ADVERSARIAL_FILENAME,
      content: HOSTED_ADVERSARIAL_CONTENT
    }
  } catch (error) {
    await removeHostedAdversarialRepositoryFixture({ root })
    throw error
  }
}

export async function removeHostedAdversarialRepositoryFixture(fixture) {
  if (!fixture?.root || path.basename(fixture.root).startsWith(fixturePrefix) === false) {
    throw new Error('Refusing to remove an invalid adversarial repository fixture')
  }
  await rm(fixture.root, { recursive: true, force: true })
}

export async function readHostedAdversarialRepositoryContent(fixture) {
  return `${await git(fixture.root, ['show', `HEAD:${fixture.filename}`])}\n`
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
  return stdout.trim()
}
