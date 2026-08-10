#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const RELEASE_DOWNLOAD_LINK_FILES = [
  'README.md',
  'docs/readme/README.es.md',
  'docs/readme/README.fr.md',
  'docs/readme/README.ja.md',
  'docs/readme/README.ko.md',
  'docs/readme/README.pt.md',
  'docs/readme/README.zh-CN.md',
  'docs/reference/headless-linux-server.md'
]

const DESKTOP_STABLE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/
const RELEASE_BASE = 'https://github.com/stablyai/orca/releases/'
const RELEASE_BASE_PATTERN = String.raw`https://github\.com/stablyai/orca/releases/`
const VERSION_TAG = 'v[0-9]+\\.[0-9]+\\.[0-9]+(?:-rc\\.[0-9]+(?:\\.[0-9A-Za-z]+)?)?'
const ASSET_LINK = new RegExp(
  `${RELEASE_BASE_PATTERN}(?:latest/download|download/${VERSION_TAG})/((?:orca|Orca)-[^\\s?)'"\\\\]+)(?:\\?download=1)?`,
  'g'
)
const LATEST_RELEASE_PAGE = new RegExp(`${RELEASE_BASE_PATTERN}latest(?=[)\\s'"\\\\]|$)`, 'g')

export function pinReleaseDownloadLinksInText(text, tag) {
  if (!DESKTOP_STABLE_TAG.test(tag)) {
    throw new Error(`Refusing non-stable release tag ${tag || '<missing>'}`)
  }
  return text
    .replace(ASSET_LINK, `${RELEASE_BASE}download/${tag}/$1?download=1`)
    .replace(LATEST_RELEASE_PAGE, `${RELEASE_BASE}tag/${tag}`)
}

export async function pinReleaseDownloadLinks(tag, paths = RELEASE_DOWNLOAD_LINK_FILES) {
  const changed = []
  for (const path of paths) {
    const before = await readFile(path, 'utf8')
    const after = pinReleaseDownloadLinksInText(before, tag)
    if (after === before) {
      continue
    }
    await writeFile(path, after)
    changed.push(path)
  }
  return changed
}

async function main() {
  const tag = process.argv[2]
  if (!tag) {
    throw new Error('Usage: node config/scripts/pin-release-download-links.mjs <stable-tag>')
  }
  const changed = await pinReleaseDownloadLinks(tag)
  console.log(
    changed.length > 0
      ? `Pinned release downloads to ${tag} in ${changed.join(', ')}`
      : `Release downloads are already pinned to ${tag}.`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
