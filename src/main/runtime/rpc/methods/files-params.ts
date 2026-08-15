import { z } from 'zod'

const RUNTIME_FILE_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

function isValidRuntimeFileBase64(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length % 4 !== 1 && RUNTIME_FILE_BASE64_PATTERN.test(value)
  )
}

export const WorktreeSelector = z.object({
  worktree: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing worktree selector'))
})

export const FilePathSearch = WorktreeSelector.extend({
  query: z.string().max(256).default(''),
  limit: z.number().int().positive().max(32).default(16)
})

export const FileOpen = WorktreeSelector.extend({
  relativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing relative path'))
})

export const FileMutationOpen = FileOpen.extend({
  expectedExecutionHostId: z.string().min(1).optional(),
  expectedSshTargetId: z.string().min(1).optional(),
  expectedSshConnectionGeneration: z.number().int().nonnegative().optional()
})

export const ResolveTerminalPath = WorktreeSelector.extend({
  pathText: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing path text')),
  terminal: z
    .unknown()
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))
    .nullable()
    .optional(),
  cwd: z
    .unknown()
    .transform((v) => (typeof v === 'string' && v.length > 0 ? v : null))
    .nullable()
    .optional(),
  crossWorkspace: z
    .unknown()
    .transform((v) => v === true)
    .optional(),
  nativeChatContext: z
    .object({
      tabId: z.string().min(1),
      sessionId: z.string().min(1)
    })
    .optional()
})

export const TerminalArtifactFile = WorktreeSelector.extend({
  grantId: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing terminal artifact grant')),
  absolutePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing terminal artifact path'))
})

export const TerminalArtifactFileWrite = TerminalArtifactFile.extend({
  content: z
    .unknown()
    .refine((v): v is string => typeof v === 'string', { message: 'Missing file content' })
})

export const FileOpenDiff = FileOpen.extend({
  staged: z.boolean().optional()
})

export const FileTreePath = WorktreeSelector.extend({
  relativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string())
})

export const ServerDirectoryBrowse = z.object({
  path: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string())
})

// Why: write content must be a real string. Coercing a missing/non-string value
// to '' silently truncated the target file to empty instead of erroring. An
// explicit '' is still accepted (writing an empty file is legitimate).
export const FileWrite = FileMutationOpen.extend({
  content: z
    .unknown()
    .refine((v): v is string => typeof v === 'string', { message: 'Missing file content' })
})

export const FileWriteBase64 = FileMutationOpen.extend({
  contentBase64: z
    .unknown()
    .refine((v): v is string => typeof v === 'string', { message: 'Missing file content' })
    // Why: Buffer.from(..., 'base64') accepts malformed input by dropping
    // invalid bytes, which can silently create empty or corrupt uploaded files.
    .refine(isValidRuntimeFileBase64, 'File content must be base64')
})

export const FileWriteBase64Chunk = FileWriteBase64.extend({
  append: z.boolean().optional()
})

export const FileReadChunk = FileOpen.extend({
  offset: z.number().int().nonnegative(),
  length: z
    .number()
    .int()
    .positive()
    .max(512 * 1024)
})

export const FileRename = WorktreeSelector.extend({
  expectedExecutionHostId: z.string().min(1).optional(),
  expectedSshTargetId: z.string().min(1).optional(),
  expectedSshConnectionGeneration: z.number().int().nonnegative().optional(),
  oldRelativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing source path')),
  newRelativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing destination path'))
})

export const FileCopy = WorktreeSelector.extend({
  expectedExecutionHostId: z.string().min(1).optional(),
  expectedSshTargetId: z.string().min(1).optional(),
  expectedSshConnectionGeneration: z.number().int().nonnegative().optional(),
  sourceRelativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing source path')),
  destinationRelativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing destination path'))
})

export const FileCommitUpload = WorktreeSelector.extend({
  expectedExecutionHostId: z.string().min(1).optional(),
  expectedSshTargetId: z.string().min(1).optional(),
  expectedSshConnectionGeneration: z.number().int().nonnegative().optional(),
  tempRelativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing temporary path')),
  finalRelativePath: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing final path'))
})

export const FileDelete = FileMutationOpen.extend({
  recursive: z.boolean().optional()
})

export const FileSearch = WorktreeSelector.extend({
  query: z
    .unknown()
    .transform((v) => (typeof v === 'string' ? v : ''))
    .pipe(z.string().min(1, 'Missing search query')),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  useRegex: z.boolean().optional(),
  includePattern: z.string().optional(),
  excludePattern: z.string().optional(),
  maxResults: z.number().int().positive().optional()
})

export const FileListAll = WorktreeSelector.extend({
  excludePaths: z.array(z.string()).optional()
})

export const FileUnwatch = z.object({
  subscriptionId: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : ''))
    .pipe(z.string().min(1, 'Missing subscriptionId'))
})
