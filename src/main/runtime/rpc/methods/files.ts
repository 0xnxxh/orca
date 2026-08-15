import { defineMethod, type RpcAnyMethod } from '../core'
import { FILE_MUTATION_METHODS } from './files-mutation-rpc-methods'
import { FILE_TERMINAL_ARTIFACT_METHODS } from './files-terminal-artifact-rpc-methods'
import { FILE_WATCH_METHODS } from './file-watch-rpc-methods'
import { remoteFileContentBudget } from './files-remote-content-budget'
import {
  FileListAll,
  FileOpen,
  FileOpenDiff,
  FilePathSearch,
  FileReadChunk,
  FileSearch,
  FileTreePath,
  ResolveTerminalPath,
  ServerDirectoryBrowse,
  WorktreeSelector
} from './files-params'

export const FILE_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'files.list',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.listMobileFiles(params.worktree)
  }),
  defineMethod({
    name: 'files.searchPaths',
    params: FilePathSearch,
    handler: async (params, { runtime }) =>
      runtime.searchMobileFilePaths(params.worktree, params.query, params.limit)
  }),
  defineMethod({
    name: 'files.open',
    params: FileOpen,
    handler: async (params, { runtime }) =>
      runtime.openMobileFile(params.worktree, params.relativePath)
  }),
  defineMethod({
    name: 'files.openDiff',
    params: FileOpenDiff,
    handler: async (params, { runtime }) =>
      runtime.openMobileDiff(params.worktree, params.relativePath, params.staged === true)
  }),
  defineMethod({
    name: 'files.read',
    params: FileOpen,
    handler: async (params, { runtime }) =>
      runtime.readMobileFile(params.worktree, params.relativePath)
  }),
  defineMethod({
    name: 'files.resolveTerminalPath',
    params: ResolveTerminalPath,
    handler: async (params, { runtime, clientId }) =>
      runtime.resolveTerminalPath(
        params.worktree,
        params.pathText,
        params.cwd ?? null,
        clientId,
        params.terminal ?? null,
        params.crossWorkspace === true,
        params.nativeChatContext ?? null
      )
  }),
  ...FILE_TERMINAL_ARTIFACT_METHODS,
  defineMethod({
    name: 'files.readPreview',
    params: FileOpen,
    handler: async (params, { runtime, clientKind, requestId }) => {
      const budget = remoteFileContentBudget(clientKind, requestId)
      return budget === undefined
        ? runtime.readFileExplorerPreview(params.worktree, params.relativePath)
        : runtime.readFileExplorerPreview(params.worktree, params.relativePath, budget)
    }
  }),
  defineMethod({
    name: 'files.readChunk',
    params: FileReadChunk,
    handler: async (params, { runtime }) =>
      runtime.readFileExplorerChunk(
        params.worktree,
        params.relativePath,
        params.offset,
        params.length
      )
  }),
  defineMethod({
    name: 'files.readDir',
    params: FileTreePath,
    handler: async (params, { runtime }) =>
      runtime.readFileExplorerDir(params.worktree, params.relativePath)
  }),
  defineMethod({
    name: 'files.browseServerDir',
    params: ServerDirectoryBrowse,
    handler: async (params, { runtime }) => runtime.browseServerDir(params.path)
  }),
  ...FILE_MUTATION_METHODS,
  defineMethod({
    name: 'files.search',
    params: FileSearch,
    handler: async (params, { runtime }) =>
      runtime.searchRuntimeFiles(params.worktree, {
        query: params.query,
        caseSensitive: params.caseSensitive,
        wholeWord: params.wholeWord,
        useRegex: params.useRegex,
        includePattern: params.includePattern,
        excludePattern: params.excludePattern,
        maxResults: params.maxResults
      })
  }),
  defineMethod({
    name: 'files.listAll',
    params: FileListAll,
    handler: async (params, { runtime }) =>
      runtime.listRuntimeFiles(params.worktree, { excludePaths: params.excludePaths })
  }),
  defineMethod({
    name: 'files.listMarkdownDocuments',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.listRuntimeMarkdownDocuments(params.worktree)
  }),
  defineMethod({
    name: 'files.stat',
    params: FileTreePath,
    handler: async (params, { runtime }) =>
      runtime.statRuntimeFile(params.worktree, params.relativePath)
  }),
  ...FILE_WATCH_METHODS
]
