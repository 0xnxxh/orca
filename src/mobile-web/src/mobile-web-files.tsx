import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { File, FileWarning, Loader2, Search, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type {
  MobileWebFileEntry,
  MobileWebFileListResult
} from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebBridgeClientError } from './mobile-web-bridge-client-error'
import { MobileWebFileDirectory } from './mobile-web-file-directory'
import { MobileWebFilePreview } from './mobile-web-file-preview'
import { useMobileWebFileDirectory } from './use-mobile-web-file-directory'
import { useMobileWebFileDocument } from './use-mobile-web-file-document'
import { useMobileWebFileEditor } from './use-mobile-web-file-editor'

type SearchState = {
  loading: boolean
  result: MobileWebFileListResult | null
  error: MobileWebBridgeClientError | null
}

export function MobileWebFiles({
  client,
  workspaceId,
  connected
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  connected: boolean
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchRetry, setSearchRetry] = useState(0)
  const [search, setSearch] = useState<SearchState>({
    loading: false,
    result: null,
    error: null
  })
  const directory = useMobileWebFileDirectory({ client, workspaceId, connected })
  const fileDocument = useMobileWebFileDocument({ client, workspaceId, connected })
  const fileEditor = useMobileWebFileEditor({
    client,
    workspaceId,
    connected,
    onSaved: fileDocument.openTextFile
  })

  useEffect(() => {
    setQuery('')
    setSubmittedQuery('')
    setSearch({ loading: false, result: null, error: null })
  }, [client, workspaceId])

  useEffect(() => {
    if (!connected || !submittedQuery) {
      setSearch((current) => ({ ...current, loading: false }))
      return
    }
    const controller = new AbortController()
    setSearch((current) => ({ ...current, loading: true, error: null }))
    void client
      .fileSearch({ workspaceId, query: submittedQuery, limit: 32 }, { signal: controller.signal })
      .then((result) => {
        if (result.workspaceId !== workspaceId) {
          throw new MobileWebBridgeClientError('invalid_message', false)
        }
        if (!controller.signal.aborted) {
          setSearch({ loading: false, result, error: null })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setSearch({ loading: false, result: null, error: bridgeClientError(error) })
        }
      })
    return () => controller.abort()
  }, [client, connected, searchRetry, submittedQuery, workspaceId])

  const searching = submittedQuery.length > 0
  const loading = searching ? search.loading : directory.loading
  const openSearchFile = (file: MobileWebFileEntry): void => {
    fileEditor.cancel()
    if (file.kind === 'binary') {
      fileDocument.openBinaryFile(file.relativePath)
    } else {
      fileDocument.openTextFile(file.relativePath)
    }
  }

  return (
    <Card className="mt-4" aria-busy={loading}>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Files</CardTitle>
          <CardDescription>
            {fileCountCopy(searching ? search.result : null, submittedQuery)}
          </CardDescription>
        </div>
        <CardAction>
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <form
          className="flex gap-2 border-t border-border px-6 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            fileDocument.cancelLoad()
            fileEditor.cancel()
            setSubmittedQuery(query.trim())
          }}
        >
          <Input
            aria-label="Search workspace files"
            placeholder="Search files"
            value={query}
            disabled={!connected}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {searching ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setQuery('')
                setSubmittedQuery('')
              }}
            >
              <X />
              <span className="sr-only">Clear file search</span>
            </Button>
          ) : null}
          <Button type="submit" variant="outline" size="icon" disabled={!connected}>
            <Search />
            <span className="sr-only">Search files</span>
          </Button>
        </form>
        {searching ? (
          <MobileWebFileSearchResults
            search={search}
            connected={connected}
            onOpen={openSearchFile}
            onRetry={() => setSearchRetry((value) => value + 1)}
          />
        ) : (
          <MobileWebFileDirectory
            directory={directory}
            connected={connected}
            onNavigate={(relativePath) => {
              fileDocument.cancelLoad()
              fileEditor.cancel()
              directory.navigate(relativePath)
            }}
            onOpenFile={(relativePath) => {
              fileEditor.cancel()
              fileDocument.openFile(relativePath)
            }}
            onRetry={directory.retry}
          />
        )}
        <MobileWebFilePreview
          preview={fileDocument.preview}
          connected={connected}
          editor={fileEditor.editor}
          onLoadMore={fileDocument.loadMore}
          onCancel={fileDocument.cancelLoad}
          onBeginEdit={() => {
            const preview = fileDocument.preview
            if (preview.status === 'ready') {
              fileEditor.begin(preview.document)
            }
          }}
          onEditChange={fileEditor.setDraft}
          onSaveEdit={fileEditor.save}
          onCancelEdit={fileEditor.cancel}
        />
      </CardContent>
    </Card>
  )
}

function MobileWebFileSearchResults({
  search,
  connected,
  onOpen,
  onRetry
}: {
  search: SearchState
  connected: boolean
  onOpen: (file: MobileWebFileEntry) => void
  onRetry: () => void
}): React.JSX.Element | null {
  if (search.error) {
    return (
      <div role="alert" className="border-t border-border px-6 py-3 text-xs text-destructive">
        {fileErrorCopy(search.error)}
        {search.error.retryable ? (
          <Button
            className="ml-2"
            variant="outline"
            size="xs"
            disabled={!connected}
            onClick={onRetry}
          >
            Try again
          </Button>
        ) : null}
      </div>
    )
  }
  if (!search.result) {
    return null
  }
  if (search.result.files.length === 0) {
    return (
      <p className="border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        No matching files.
      </p>
    )
  }
  return (
    <ul className="border-t border-border">
      {search.result.files.map((file) => (
        <li key={file.relativePath} className="border-b border-border last:border-b-0">
          <Button
            variant="ghost"
            className="h-auto w-full justify-start rounded-none px-6 py-2 text-left"
            disabled={!connected}
            onClick={() => onOpen(file)}
          >
            {file.kind === 'binary' ? <FileWarning /> : <File />}
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{file.basename}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {file.relativePath}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

function fileCountCopy(result: MobileWebFileListResult | null, query: string): string {
  if (!query) {
    return 'Browse workspace folders or search by path'
  }
  if (!result) {
    return `Searching for “${query}”`
  }
  return `${result.totalCount.toLocaleString()} ${
    result.totalCount === 1 ? 'file' : 'files'
  } matching “${query}”`
}

function bridgeClientError(error: unknown): MobileWebBridgeClientError {
  return error instanceof MobileWebBridgeClientError
    ? error
    : new MobileWebBridgeClientError('internal', false)
}

function fileErrorCopy(error: MobileWebBridgeClientError): string {
  if (error.code === 'unsupported_capability') {
    return 'This Orca Mobile shell does not expose file search.'
  }
  if (error.code === 'not_connected') {
    return 'Reconnect to the paired desktop to search files.'
  }
  return 'The paired desktop could not search these files.'
}
