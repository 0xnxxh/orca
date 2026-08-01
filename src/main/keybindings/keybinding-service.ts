import {
  LEGACY_TAB_SWITCH_BINDINGS,
  type KeybindingActionId,
  type KeybindingFileSnapshot,
  type KeybindingOverrides
} from '../../shared/keybindings'
import {
  ensureKeybindingFile,
  ensureKeybindingFileAsync,
  getUserKeybindingsPath,
  migrateLegacyKeybindings,
  readKeybindingFile,
  readKeybindingFileAsync,
  readKeybindingFileExclusiveAsync,
  seedLegacyTabSwitchBindings,
  writeKeybindingOverride,
  writeKeybindingOverrideAsync
} from './keybinding-file'

export type KeybindingServiceOptions = {
  homePath: string
  platform?: NodeJS.Platform
  getLegacyOverrides?: () => KeybindingOverrides | undefined
  /** Cohort seed for the tab-switch convention swap. `isPending` is true only
   *  for pre-existing installs on the first launch after the swap; `markSeeded`
   *  freezes the one-shot so it never runs again. */
  legacyTabSwitchSeed?: {
    isPending: () => boolean
    markSeeded: () => void
  }
}

export class KeybindingService {
  private readonly configPath: string
  private readonly platform: NodeJS.Platform
  private snapshot: KeybindingFileSnapshot | null = null

  constructor(options: KeybindingServiceOptions) {
    this.configPath = getUserKeybindingsPath(options.homePath)
    this.platform = options.platform ?? process.platform
    // Why: older builds persisted custom shortcuts inside global settings.
    // Once a keybindings file exists, it is the sole source of truth.
    migrateLegacyKeybindings(this.configPath, this.platform, options.getLegacyOverrides?.())
    // Why: pre-existing installs keep the old tab-switch chords. Only mark the
    // one-shot done on success so a transient IO failure retries next launch
    // instead of silently dropping the pin.
    if (options.legacyTabSwitchSeed?.isPending()) {
      try {
        // Why: the seed already read the file to build its snapshot — prime the
        // lazy cache with it instead of re-reading on the first getSnapshot().
        this.snapshot = seedLegacyTabSwitchBindings(
          this.configPath,
          this.platform,
          LEGACY_TAB_SWITCH_BINDINGS
        ).snapshot
        options.legacyTabSwitchSeed.markSeeded()
      } catch (error) {
        console.error('Failed to seed legacy tab-switch keybindings:', error)
      }
    }
    // Why: sync callers (menu build, browser/runtime settings resolvers) cannot
    // await. Warm the cache here, pre-window, so they never trigger a lazy sync
    // read later — that read would freeze the UI if ~/.orca is on a stalled mount.
    this.snapshot ??= readKeybindingFile(this.configPath, this.platform)
  }

  getPath(): string {
    return this.configPath
  }

  /** Sync accessor for callers that cannot await; served from the warm cache. */
  getSnapshot(): KeybindingFileSnapshot {
    if (!this.snapshot) {
      this.snapshot = readKeybindingFile(this.configPath, this.platform)
    }
    return this.snapshot
  }

  async getSnapshotAsync(): Promise<KeybindingFileSnapshot> {
    this.snapshot ??= await readKeybindingFileAsync(this.configPath, this.platform)
    return this.snapshot
  }

  reload(): KeybindingFileSnapshot {
    this.snapshot = readKeybindingFile(this.configPath, this.platform)
    return this.snapshot
  }

  async reloadAsync(): Promise<KeybindingFileSnapshot> {
    // Ordered against in-flight writes so a reload started before one cannot
    // install the pre-write snapshot over it.
    this.snapshot = await readKeybindingFileExclusiveAsync(this.configPath, this.platform)
    return this.snapshot
  }

  getOverrides(): KeybindingOverrides {
    return this.getSnapshot().overrides
  }

  ensureFile(): KeybindingFileSnapshot {
    ensureKeybindingFile(this.configPath)
    return this.reload()
  }

  async ensureFileAsync(): Promise<KeybindingFileSnapshot> {
    await ensureKeybindingFileAsync(this.configPath)
    return this.reloadAsync()
  }

  setActionBindings(
    actionId: KeybindingActionId,
    bindings: string[] | null
  ): KeybindingFileSnapshot {
    this.snapshot = writeKeybindingOverride(this.configPath, this.platform, actionId, bindings)
    return this.snapshot
  }

  async setActionBindingsAsync(
    actionId: KeybindingActionId,
    bindings: string[] | null
  ): Promise<KeybindingFileSnapshot> {
    this.snapshot = await writeKeybindingOverrideAsync(
      this.configPath,
      this.platform,
      actionId,
      bindings
    )
    return this.snapshot
  }
}
