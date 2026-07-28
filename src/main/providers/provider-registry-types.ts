import type { IFilesystemProvider, IGitProvider, IPtyProvider } from './types'

/** Routes operations by connectionId; null/undefined selects the local provider. */
export type IProviderRegistry = {
  getPtyProvider(connectionId: string | null | undefined): IPtyProvider
  getFilesystemProvider(connectionId: string | null | undefined): IFilesystemProvider
  getGitProvider(connectionId: string | null | undefined): IGitProvider
}
