import type { EditorChromeSlice } from './editor-chrome-slice'
import type { EditorFilesSlice } from './editor-files-slice'
import type { EditorGitSlice } from './editor-git-slice'

export type EditorSlice = EditorChromeSlice & EditorFilesSlice & EditorGitSlice
