import type { BigIntStats } from 'node:fs'
import { lstat, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { TerminalLegacyGcProtection } from '../shared/terminal-legacy-cutover'

export type LegacyRelayGcFileSystem = Readonly<{
  lstat: typeof lstat
  realpath: typeof realpath
  rename: typeof rename
  rm: typeof rm
}>

export type LegacyRelayGcPathIdentity = Readonly<{
  device: string
  inode: string
  changedAtNs: string
  bornAtNs: string
  modifiedAtNs: string
  mode: string
  size: string
  directory: boolean
}>

export type LegacyRelayGcCandidate = Readonly<{
  reportedPath: string
  removalPath: string
  identity: LegacyRelayGcPathIdentity
}>

export const defaultLegacyRelayGcFileSystem: LegacyRelayGcFileSystem = {
  lstat,
  realpath,
  rename,
  rm
}

export async function canonicalLegacyRelayGcRoots(
  roots: readonly string[],
  fileSystem: LegacyRelayGcFileSystem = defaultLegacyRelayGcFileSystem
): Promise<readonly string[]> {
  const canonical: string[] = []
  for (const root of roots) {
    const normalized = assertSafeAbsolutePath(root, 'allowed root')
    const stats = await fileSystem.lstat(normalized)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('legacy relay GC allowed root is not a real directory')
    }
    const resolved = await fileSystem.realpath(normalized)
    assertSafeAbsolutePath(resolved, 'canonical allowed root')
    canonical.push(normalizeForComparison(normalized), normalizeForComparison(resolved))
  }
  return Object.freeze([...new Set(canonical)].sort())
}

export async function eligibleLegacyRelayGcCandidates(input: {
  eligible: TerminalLegacyGcProtection
  protected: TerminalLegacyGcProtection
  allowedRoots: readonly string[]
  fileSystem?: LegacyRelayGcFileSystem
}): Promise<readonly LegacyRelayGcCandidate[]> {
  const fileSystem = input.fileSystem ?? defaultLegacyRelayGcFileSystem
  const protectedLexical = protectionPaths(input.protected)
  const protectedCanonical = await existingCanonicalPaths(protectedLexical, fileSystem)
  const raw = [
    ...input.eligible.evidencePaths.map((candidate) => ({ candidate, directory: false })),
    ...input.eligible.relayDirectories.map((candidate) => ({ candidate, directory: true }))
  ]
  const candidates = new Map<string, LegacyRelayGcCandidate>()
  for (const entry of raw) {
    if (isWindowsNamedPipe(entry.candidate)) {
      continue
    }
    const lexical = assertLegacyRelayGcCandidatePath(entry.candidate, input.allowedRoots)
    if (protectedLexical.some((protectedPath) => pathsOverlap(lexical, protectedPath))) {
      continue
    }
    const inspected = await inspectCandidate(
      lexical,
      entry.directory,
      input.allowedRoots,
      protectedCanonical,
      fileSystem
    )
    if (inspected) {
      candidates.set(normalizeForComparison(inspected.removalPath), inspected)
    }
  }
  return Object.freeze(
    [...candidates.values()].sort(
      (left, right) => right.reportedPath.length - left.reportedPath.length
    )
  )
}

export function assertLegacyRelayGcCandidatePath(
  candidate: string,
  allowedRoots: readonly string[]
): string {
  const normalized = assertSafeAbsolutePath(candidate, 'candidate')
  if (!allowedRoots.some((root) => strictlyContainsPath(root, normalized))) {
    throw new Error('legacy relay GC candidate is outside its authority-owned root')
  }
  return normalized
}

export async function legacyRelayGcCandidateIsProtected(
  candidate: LegacyRelayGcCandidate,
  protection: TerminalLegacyGcProtection,
  fileSystem: LegacyRelayGcFileSystem = defaultLegacyRelayGcFileSystem
): Promise<boolean> {
  const lexical = protectionPaths(protection)
  if (
    lexical.some(
      (protectedPath) =>
        pathsOverlap(candidate.reportedPath, protectedPath) ||
        pathsOverlap(candidate.removalPath, protectedPath)
    )
  ) {
    return true
  }
  const canonical = await existingCanonicalPaths(lexical, fileSystem)
  return canonical.some((protectedPath) => pathsOverlap(candidate.removalPath, protectedPath))
}

export async function readLegacyRelayGcPathIdentity(
  candidatePath: string,
  fileSystem: LegacyRelayGcFileSystem = defaultLegacyRelayGcFileSystem
): Promise<LegacyRelayGcPathIdentity | null> {
  let stats: BigIntStats
  try {
    stats = await fileSystem.lstat(candidatePath, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (stats.isSymbolicLink()) {
    return null
  }
  return Object.freeze({
    device: String(stats.dev),
    inode: String(stats.ino),
    changedAtNs: String(stats.ctimeNs),
    bornAtNs: String(stats.birthtimeNs),
    modifiedAtNs: String(stats.mtimeNs),
    mode: String(stats.mode),
    size: String(stats.size),
    directory: stats.isDirectory()
  })
}

export function sameLegacyRelayGcPathIdentity(
  left: LegacyRelayGcPathIdentity | null,
  right: LegacyRelayGcPathIdentity | null
): boolean {
  return Boolean(
    left &&
    right &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.bornAtNs === right.bornAtNs &&
    left.modifiedAtNs === right.modifiedAtNs &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.directory === right.directory
  )
}

async function inspectCandidate(
  lexical: string,
  directory: boolean,
  allowedRoots: readonly string[],
  protectedCanonical: readonly string[],
  fileSystem: LegacyRelayGcFileSystem
): Promise<LegacyRelayGcCandidate | null> {
  const identity = await readLegacyRelayGcPathIdentity(lexical, fileSystem)
  if (!identity) {
    return null
  }
  if (directory && !identity.directory) {
    throw new Error('legacy relay GC candidate type is unsafe')
  }
  const canonical = normalizeForComparison(await fileSystem.realpath(lexical))
  assertLegacyRelayGcCandidatePath(canonical, allowedRoots)
  if (protectedCanonical.some((protectedPath) => pathsOverlap(canonical, protectedPath))) {
    return null
  }
  return Object.freeze({ reportedPath: lexical, removalPath: canonical, identity })
}

async function existingCanonicalPaths(
  paths: readonly string[],
  fileSystem: LegacyRelayGcFileSystem
): Promise<readonly string[]> {
  const canonical: string[] = []
  for (const candidate of paths) {
    if (isWindowsNamedPipe(candidate)) {
      continue
    }
    try {
      canonical.push(normalizeForComparison(await fileSystem.realpath(candidate)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }
  return Object.freeze(canonical)
}

function protectionPaths(protection: TerminalLegacyGcProtection): string[] {
  return [...protection.relayDirectories, ...protection.evidencePaths]
    .filter((candidate) => !isWindowsNamedPipe(candidate))
    .map((candidate) => assertSafeAbsolutePath(candidate, 'protected path'))
}

function assertSafeAbsolutePath(candidate: string, role: string): string {
  const api = pathApi(candidate)
  if (!candidate || candidate.includes('\0') || !api.isAbsolute(candidate)) {
    throw new Error(`legacy relay GC ${role} is not absolute`)
  }
  const normalized = api.normalize(candidate)
  if (samePath(normalized, api.parse(normalized).root)) {
    throw new Error(`legacy relay GC ${role} is too broad`)
  }
  return normalized
}

function strictlyContainsPath(parent: string, child: string): boolean {
  if (pathFlavor(parent) !== pathFlavor(child)) {
    return false
  }
  const api = pathApi(parent)
  const relative = api.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !api.isAbsolute(relative)
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    samePath(left, right) || strictlyContainsPath(left, right) || strictlyContainsPath(right, left)
  )
}

function samePath(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right)
}

function normalizeForComparison(candidate: string): string {
  const normalized = pathApi(candidate).normalize(candidate)
  return pathFlavor(candidate) === 'win32' ? normalized.toLowerCase() : normalized
}

function pathApi(candidate: string): typeof path.posix | typeof path.win32 {
  return pathFlavor(candidate) === 'win32' ? path.win32 : path.posix
}

function pathFlavor(candidate: string): 'posix' | 'win32' {
  return /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\') ? 'win32' : 'posix'
}

function isWindowsNamedPipe(candidate: string): boolean {
  return /^\\\\[.?]\\pipe\\/i.test(candidate)
}
