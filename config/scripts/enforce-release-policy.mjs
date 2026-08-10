#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const API_VERSION = '2022-11-28'
const RELEASE_AUTOMATION_AUTHOR = 'github-actions[bot]'
const VERSION_NUMBER = '(?:0|[1-9][0-9]*)'
const CORE_VERSION = `${VERSION_NUMBER}\\.${VERSION_NUMBER}\\.${VERSION_NUMBER}`
const DESKTOP_STABLE_TAG = new RegExp(`^v${CORE_VERSION}$`)
const DESKTOP_RC_TAG = new RegExp(`^v${CORE_VERSION}-rc\\.${VERSION_NUMBER}(?:\\.[0-9A-Za-z]+)?$`)
const MOBILE_TAG = new RegExp(`^mobile(?:-android)?-v${CORE_VERSION}$`)

export function classifyRelease(release) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name : ''
  const author = release?.author?.login
  if (author !== RELEASE_AUTOMATION_AUTHOR) {
    return { allowed: false, reason: `release author ${author || '<unknown>'} is not automation` }
  }
  if (DESKTOP_STABLE_TAG.test(tag)) {
    return { allowed: true, expectedPrerelease: false, kind: 'desktop-stable' }
  }
  if (DESKTOP_RC_TAG.test(tag)) {
    return { allowed: true, expectedPrerelease: true, kind: 'desktop-prerelease' }
  }
  if (MOBILE_TAG.test(tag)) {
    return { allowed: true, expectedPrerelease: true, kind: 'mobile' }
  }
  return { allowed: false, reason: `tag ${tag || '<missing>'} is not an Orca release tag` }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': API_VERSION
  }
}

async function githubRequest(fetchImpl, token, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...githubHeaders(token), ...init.headers }
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `GitHub request failed ${response.status} ${response.statusText}: ${body.slice(0, 300)}`
    )
  }
  return response
}

async function fetchReleases(fetchImpl, token, repo) {
  const releases = []
  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      fetchImpl,
      token,
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`
    )
    const pageReleases = await response.json()
    if (!Array.isArray(pageReleases)) {
      throw new Error(`GitHub releases response page ${page} was not an array`)
    }
    releases.push(...pageReleases)
    if (pageReleases.length < 100) {
      return releases
    }
  }
}

export function latestAllowedStableRelease(releases) {
  return releases
    .filter(
      (release) =>
        release?.draft !== true &&
        release?.prerelease !== true &&
        classifyRelease(release).kind === 'desktop-stable'
    )
    .map((release) => ({
      release,
      version: release.tag_name.slice(1).split('.').map(Number)
    }))
    .sort((left, right) =>
      left.version.reduce((result, part, index) => result || part - right.version[index], 0)
    )
    .at(-1)?.release
}

function releaseApiUrl(repo, releaseId) {
  return `https://api.github.com/repos/${repo}/releases/${releaseId}`
}

function tagRefApiUrl(repo, tag) {
  const encodedTag = tag.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${repo}/git/refs/tags/${encodedTag}`
}

async function restoreLatestStableRelease(fetchImpl, token, repo) {
  const stableRelease = latestAllowedStableRelease(await fetchReleases(fetchImpl, token, repo))
  if (!stableRelease) {
    return null
  }
  await githubRequest(fetchImpl, token, releaseApiUrl(repo, stableRelease.id), {
    method: 'PATCH',
    body: JSON.stringify({ make_latest: 'true' })
  })
  return stableRelease.tag_name
}

export async function enforceReleasePolicy({
  release,
  repo,
  token,
  fetchImpl = fetch,
  log = console.log
}) {
  if (!repo || !token) {
    throw new Error('repo and token are required')
  }
  if (!Number.isInteger(release?.id)) {
    throw new Error('release event is missing a numeric release id')
  }

  const classification = classifyRelease(release)
  const url = releaseApiUrl(repo, release.id)
  if (classification.allowed) {
    if (release.prerelease === classification.expectedPrerelease) {
      log(`Allowed ${classification.kind} release ${release.tag_name}.`)
      return { action: 'allowed', tag: release.tag_name }
    }

    await githubRequest(fetchImpl, token, url, {
      method: 'PATCH',
      body: JSON.stringify({
        prerelease: classification.expectedPrerelease,
        make_latest: classification.expectedPrerelease ? 'false' : 'legacy'
      })
    })
    if (classification.expectedPrerelease) {
      await restoreLatestStableRelease(fetchImpl, token, repo)
    }
    log(`Repaired ${classification.kind} release state for ${release.tag_name}.`)
    return { action: 'repaired', tag: release.tag_name }
  }

  await githubRequest(fetchImpl, token, url, {
    method: 'PATCH',
    body: JSON.stringify({ draft: true, prerelease: true, make_latest: 'false' })
  })
  await restoreLatestStableRelease(fetchImpl, token, repo)
  await githubRequest(fetchImpl, token, url, { method: 'DELETE' })
  await githubRequest(fetchImpl, token, tagRefApiUrl(repo, release.tag_name), { method: 'DELETE' })
  log(`Deleted unauthorized release ${release.tag_name}: ${classification.reason}.`)
  return { action: 'deleted', tag: release.tag_name, reason: classification.reason }
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is required')
  }
  const event = JSON.parse(await readFile(eventPath, 'utf8'))
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const result = await enforceReleasePolicy({ release: event.release, repo, token })
  console.log(`Release policy action: ${result.action}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
