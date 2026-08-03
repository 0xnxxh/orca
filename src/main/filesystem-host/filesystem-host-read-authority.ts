import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import type {
  FilesystemCliCommandName,
  FilesystemSnapshotFileKind,
  RateLimitCredentialFileKind
} from '../../shared/filesystem-host-protocol'
import { FilesystemHostBackgroundQueue } from './filesystem-host-background-queue'
import { FilesystemHostFailureDomainHydrator } from './filesystem-host-failure-domain-hydrator'
import { writeFilesystemHostRateLimitCredential } from './filesystem-host-rate-limit-credential-client'
import { resolveFilesystemHostCliCommand } from './filesystem-host-cli-command-client'
import { FilesystemHostSupervisor } from './filesystem-host-supervisor'
import { routeFilesystemHostPath } from './filesystem-host-path-route'
import type { FilesystemStorageClass } from './filesystem-host-telemetry'
import {
  FilesystemHostReadError,
  filesystemHostReadFailureReason,
  requireFilesystemHostResult
} from './filesystem-host-read-result'

export {
  FilesystemHostReadError,
  type FilesystemHostReadFailureReason
} from './filesystem-host-read-result'

const AUTHORIZATION_DEADLINE_MS = 2_000
const BACKGROUND_READ_DEADLINE_MS = 5_000
const BACKGROUND_OPERATION_CONCURRENCY = 4

type Dispatch = FilesystemHostSupervisor['dispatch']
type PublishFailureDomain = FilesystemHostSupervisor['publishFailureDomain']

export type FilesystemHostReadClient = {
  canonicalizePath(path: string, storageClass?: FilesystemStorageClass): Promise<string>
  readOrcaYaml(path: string): Promise<string>
  readKeybindings(path: string): Promise<string>
  readSnapshotFile(path: string, fileKind: FilesystemSnapshotFileKind): Promise<Buffer>
  prepareRateLimitPtyCwd(path: string): Promise<string>
  resolveCliCommand?(commandName: FilesystemCliCommandName): Promise<string>
  writeRateLimitCredential?(
    path: string,
    fileKind: RateLimitCredentialFileKind,
    contents: string
  ): Promise<void>
}

export type FilesystemHostReadAuthorityOptions = {
  entryPath: string
  platform?: NodeJS.Platform
  supervisor?: {
    dispatch: Dispatch
    publishFailureDomain: PublishFailureDomain
    removeFailureDomain: FilesystemHostSupervisor['removeFailureDomain']
    dispose(): Promise<void>
  }
}

export class FilesystemHostReadAuthority implements FilesystemHostReadClient {
  private readonly supervisor: NonNullable<FilesystemHostReadAuthorityOptions['supervisor']>
  private readonly platform: NodeJS.Platform
  private readonly backgroundQueue = new FilesystemHostBackgroundQueue(
    BACKGROUND_OPERATION_CONCURRENCY
  )
  private readonly failureDomains: FilesystemHostFailureDomainHydrator

  constructor(options: FilesystemHostReadAuthorityOptions) {
    this.platform = options.platform ?? process.platform
    this.supervisor =
      options.supervisor ?? new FilesystemHostSupervisor({ entryPath: options.entryPath })
    this.failureDomains = new FilesystemHostFailureDomainHydrator(
      this.supervisor,
      this.backgroundQueue,
      (path) => routeFilesystemHostPath(path, 'workspace', this.platform),
      BACKGROUND_READ_DEADLINE_MS
    )
  }

  async canonicalizePath(
    path: string,
    storageClass: FilesystemStorageClass = 'workspace'
  ): Promise<string> {
    const route = routeFilesystemHostPath(path, storageClass, this.platform)
    try {
      const result = await this.supervisor.dispatch({
        operationId: randomUUID(),
        operation: { kind: 'canonicalize-path', path },
        ...route,
        admission: 'foreground',
        deadlineMs: AUTHORIZATION_DEADLINE_MS
      })
      return requireFilesystemHostResult(result, 'canonicalize-path').canonicalPath
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    }
  }

  async readOrcaYaml(path: string): Promise<string> {
    const releaseFailureDomain = await this.failureDomains
      .acquire(dirname(path))
      .catch(() => () => {})
    const route = routeFilesystemHostPath(path, 'workspace', this.platform)
    try {
      const result = await this.backgroundQueue.run(() =>
        this.supervisor.dispatch({
          operationId: randomUUID(),
          operation: { kind: 'read-orca-yaml', path, maxBytes: 1024 * 1024 },
          ...route,
          admission: 'background',
          deadlineMs: BACKGROUND_READ_DEADLINE_MS
        })
      )
      return requireFilesystemHostResult(result, 'read-orca-yaml').contents
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    } finally {
      releaseFailureDomain()
    }
  }

  async readKeybindings(path: string): Promise<string> {
    const route = routeFilesystemHostPath(path, 'home', this.platform)
    try {
      const result = await this.supervisor.dispatch({
        operationId: randomUUID(),
        operation: { kind: 'read-keybindings', path, maxBytes: 1024 * 1024 },
        ...route,
        admission: 'foreground',
        deadlineMs: BACKGROUND_READ_DEADLINE_MS
      })
      return requireFilesystemHostResult(result, 'read-keybindings').contents
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    }
  }

  async readSnapshotFile(path: string, fileKind: FilesystemSnapshotFileKind): Promise<Buffer> {
    const route = routeFilesystemHostPath(path, 'home', this.platform)
    try {
      const result = await this.backgroundQueue.run(() =>
        this.supervisor.dispatch({
          operationId: randomUUID(),
          operation: { kind: 'read-snapshot-file', path, fileKind },
          ...route,
          admission: 'background',
          deadlineMs: BACKGROUND_READ_DEADLINE_MS
        })
      )
      return Buffer.from(
        requireFilesystemHostResult(result, 'read-snapshot-file').contentsBase64,
        'base64'
      )
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    }
  }

  async prepareRateLimitPtyCwd(path: string): Promise<string> {
    const route = routeFilesystemHostPath(path, 'user-data', this.platform)
    try {
      const result = await this.backgroundQueue.run(() =>
        this.supervisor.dispatch({
          operationId: randomUUID(),
          operation: { kind: 'prepare-rate-limit-pty-cwd', path },
          ...route,
          admission: 'background',
          deadlineMs: BACKGROUND_READ_DEADLINE_MS
        })
      )
      return requireFilesystemHostResult(result, 'prepare-rate-limit-pty-cwd').canonicalPath
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    }
  }

  async resolveCliCommand(commandName: FilesystemCliCommandName): Promise<string> {
    const path = homedir()
    try {
      return await resolveFilesystemHostCliCommand({
        commandName,
        homePath: path,
        pathEnvironment: process.env.PATH ?? process.env.Path ?? '',
        route: routeFilesystemHostPath(path, 'home', this.platform),
        deadlineMs: BACKGROUND_READ_DEADLINE_MS,
        queue: this.backgroundQueue,
        dispatch: (input) => this.supervisor.dispatch(input)
      })
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    }
  }

  async writeRateLimitCredential(
    path: string,
    fileKind: RateLimitCredentialFileKind,
    contents: string
  ): Promise<void> {
    try {
      await writeFilesystemHostRateLimitCredential({
        path,
        fileKind,
        contents,
        route: routeFilesystemHostPath(path, 'home', this.platform),
        deadlineMs: BACKGROUND_READ_DEADLINE_MS,
        queue: this.backgroundQueue,
        dispatch: (input) => this.supervisor.dispatch(input)
      })
    } catch (error) {
      throw new FilesystemHostReadError(filesystemHostReadFailureReason(error))
    }
  }

  hydrateFailureDomains(paths: readonly string[]): void {
    this.failureDomains.hydrate(paths)
  }

  reconcileFailureDomains(paths: readonly string[]): void {
    this.failureDomains.reconcile(paths)
  }

  dispose(): Promise<void> {
    this.backgroundQueue.dispose()
    return this.supervisor.dispose()
  }
}

const READ_AUTHORITY_STATE_KEY = '__orcaFilesystemHostReadAuthorityState'

type FilesystemHostReadAuthorityState = {
  client: FilesystemHostReadClient | null
  authority: FilesystemHostReadAuthority | null
}

function getReadAuthorityState(): FilesystemHostReadAuthorityState {
  const scope = globalThis as unknown as Record<string, unknown>
  let state = scope[READ_AUTHORITY_STATE_KEY] as FilesystemHostReadAuthorityState | undefined
  if (!state) {
    state = { client: null, authority: null }
    scope[READ_AUTHORITY_STATE_KEY] = state
  }
  return state
}

export function configureFilesystemHostReadAuthority(authority: FilesystemHostReadAuthority): void {
  const state = getReadAuthorityState()
  state.client = authority
  state.authority = authority
}

export function setFilesystemHostReadClientForTests(client: FilesystemHostReadClient | null): void {
  const state = getReadAuthorityState()
  state.client = client
  state.authority = null
}

export function hydrateFilesystemHostFailureDomains(paths: readonly string[]): void {
  getReadAuthorityState().authority?.hydrateFailureDomains(paths)
}

export function reconcileFilesystemHostFailureDomains(paths: readonly string[]): void {
  getReadAuthorityState().authority?.reconcileFailureDomains(paths)
}

export function requireFilesystemHostReadClient(): FilesystemHostReadClient {
  const client = getReadAuthorityState().client
  if (!client) {
    throw new FilesystemHostReadError('unavailable')
  }
  return client
}

const requireClient = requireFilesystemHostReadClient

export async function canonicalizePathThroughFilesystemHost(
  path: string,
  storageClass?: FilesystemStorageClass
): Promise<string> {
  return await requireClient().canonicalizePath(path, storageClass)
}

export async function readOrcaYamlThroughFilesystemHost(path: string): Promise<string> {
  return await requireClient().readOrcaYaml(path)
}

export async function readKeybindingsThroughFilesystemHost(path: string): Promise<string> {
  return await requireClient().readKeybindings(path)
}

export async function readSnapshotFileThroughFilesystemHost(
  path: string,
  fileKind: FilesystemSnapshotFileKind
): Promise<Buffer> {
  return await requireClient().readSnapshotFile(path, fileKind)
}

export async function prepareRateLimitPtyCwdThroughFilesystemHost(path: string): Promise<string> {
  return await requireClient().prepareRateLimitPtyCwd(path)
}
