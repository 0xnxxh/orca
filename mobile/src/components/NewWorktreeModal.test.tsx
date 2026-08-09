import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostWorkspaceCreationOperations } from '../worktree/host-workspace-creation-operations'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn() },
  Linking: { openURL: vi.fn() },
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
// Every icon in the drawer tree renders as a host element named after itself.
vi.mock(
  'lucide-react-native',
  () =>
    new Proxy(
      {},
      {
        get: (_target, name) => (typeof name === 'string' ? name : undefined),
        has: () => true
      }
    )
)
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./bottom-drawer-modal-host', () => ({ BottomDrawerModalHost: 'BottomDrawerModalHost' }))
vi.mock('./PickerListDrawer', () => ({ PickerListDrawer: 'PickerListDrawer' }))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./TaskProviderLogo', () => ({ TaskProviderLogo: 'TaskProviderLogo' }))

import { setCachedRepos } from '../cache/repo-cache'
import { NewWorktreeModal } from './NewWorktreeModal'

const repos = [{ id: 'repo-1', displayName: 'orca', path: '/src/orca', kind: 'git' }]

function repoPickerNames(renderer: ReactTestRenderer | null): string[] {
  const pickers = renderer?.root.findAll((node) => node.type === 'PickerListDrawer') ?? []
  const repoPicker = pickers.find((node) => node.props.title === 'Repository')
  return ((repoPicker?.props.items ?? []) as { label: string }[]).map((item) => item.label)
}

describe('NewWorktreeModal repo list', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    setCachedRepos('host-1', repos)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the cached repos when the in-flight repo.list rejects on a dropped connection', async () => {
    const listRepositories = vi.fn().mockRejectedValue(new Error('connection closed'))
    const operations = new Proxy(
      {
        listRepositories,
        readRuntimeCapabilities: vi.fn().mockResolvedValue({
          tasksSupported: false,
          idempotentWorktreeCreateSupported: false
        }),
        readRuntimeSettings: vi.fn().mockResolvedValue({}),
        readTrustedHooks: vi.fn().mockResolvedValue({}),
        isGitLabCliInstalled: vi.fn().mockResolvedValue(false),
        isLinearConnected: vi.fn().mockResolvedValue(false)
      },
      {
        get(target, property) {
          if (property in target) {
            return target[property as keyof typeof target]
          }
          return vi.fn().mockResolvedValue(null)
        }
      }
    ) as unknown as HostWorkspaceCreationOperations

    await act(async () => {
      renderer = create(
        createElement(NewWorktreeModal, {
          visible: true,
          operations,
          hostId: 'host-1',
          openExternalUrl: vi.fn(),
          onCreated: () => {},
          onClose: () => {}
        })
      )
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(listRepositories).toHaveBeenCalledOnce()
    expect(repoPickerNames(renderer)).toEqual(['orca'])
  })
})
