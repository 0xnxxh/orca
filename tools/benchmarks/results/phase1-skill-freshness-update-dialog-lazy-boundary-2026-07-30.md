# Phase 1 skill-freshness update-dialog lazy boundary

Date: 2026-07-30

Outcome: retained. A fresh production A/B comparison reduced the main-window static
renderer closure by 31,209 raw bytes without increasing the popout or web static
closure, changing any renderer JS/CSS count, or changing any Electron main/preload
file.

## Scope and ownership audit

The production path before this tranche was:

`index.html -> assets/App-DqvhbNhX.js -> SkillFreshnessUpdateDialog`

`App.tsx` statically imported the full dialog. The dialog in turn owned freshness,
run-store, request-store, installed-skill notification, row, dialog primitive, and
clipboard/rendering dependencies. The dialog implementation and its `"Update
skills"` title were therefore emitted in the 1,583,371-byte static
`assets/App-DqvhbNhX.js` chunk.

The production consumers audited before editing were:

- `App.tsx`: mounted the dialog under `LinkRoutingPreferenceDialogProvider`.
- `SkillFreshnessNudge.tsx`: remains always mounted outside that provider and remains
  the startup `useSkillFreshness` scan/listener owner.
- `skill-freshness-update-dialog.ts`: already held a module-global durable
  `pendingOpen` snapshot, so an open request before host subscription is retained.
- `SkillFreshnessStatusPill.tsx` and `SkillUpdateStatusSegment.tsx`: request the same
  dialog; the status segment also reopens the same external run.
- `skill-update-run-store.ts`: remains the single module-cache run owner, installs
  one IPC listener through `ensureSubscribed`, preserves main-owned run continuity,
  success linger, cancellation, and acknowledgement.
- `Settings.tsx`: consumes freshness state for settings and was already a dynamic
  entry; it remains a consumer and now re-exports the lazy dialog surface.
- `SkillsPage.tsx`: consumes freshness presentation data but did not require a
  source change.
- `SkillFreshnessUpdateDialog.tsx`, `SkillUpdateRow.tsx`,
  `skill-freshness-grouping.ts`, scan-issue/summary surfaces, and
  `useInstalledAgentSkills`: preserve inventory rows, run state, clipboard,
  installed-skill refresh, and visual behavior.

The retained path is:

`index.html -> assets/App-Ci_esR-V.js -> SkillFreshnessUpdateDialogHost`

The host subscribes eagerly to the durable open snapshot, initializes its permanent
`mounted` latch from that snapshot, and eagerly calls `useSkillUpdateRun` so an
in-flight run is recovered before the dialog is requested. On the first true
snapshot it calls the shared `loadSettingsModule` dynamic importer through
`lazyWithRetry` with reload key `skill-freshness-update-dialog`; the resulting
`assets/Settings-cLZtWH0G.js` contains the dialog implementation and remains mounted
after consume/close. `Suspense` uses the existing null fallback, so no layout,
tokens, or intermediate UI changed.

The host passes the exact eager function/icon identities into the lazy surface.
This keeps the freshness cache, run store, request snapshot, installed-skill event,
and Lucide module instances singletons rather than creating parallel lazy copies.
The settings module loader is shared with the existing Settings lazy surface, so
the retained build adds no dynamic entry or static JS/CSS file.

The first allocation attempts were rejected because Rollup named the remaining
shared freshness chunk `useSkillFreshness-*`, increasing the web preload table by
two raw bytes. The retained source puts the implementation in the concrete
`hooks/skill-freshness.ts` module, retains `hooks/useSkillFreshness.ts` as a typed
compatibility facade, and qualifies eager consumers to the concrete module. This
restores the `skill-freshness-*` emitted name and exact A web raw size. The focused
source assertion was intentionally maintained to check the shared Settings loader
instead of the superseded direct `import('../settings/Settings')` expression.

No terminal/runtime routing, provider, SSH, relay, folder-workspace, keybinding,
platform, or UI behavior was changed.

## Fresh production A/B

Command for both builds:

```text
pnpm run build:electron-vite
```

Archived artifacts:

The paths below were ephemeral local build directories used during measurement,
not durable artifacts. The recorded hashes, byte counts, manifests, and
conclusions in this report are the portable evidence.

- A: `/tmp/orca-skill-freshness-dialog-a.nkg3c6`
- B: `/tmp/orca-skill-freshness-dialog-b10.ixO491`

| Entry | A raw | A gzip | A JS/CSS | B raw | B gzip | B JS/CSS | Raw delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Electron main entry | 776,873 | 174,092 | 1/0 | 776,873 | 174,092 | 1/0 | 0 |
| Electron preload entry | 130,798 | 20,642 | 1/0 | 130,798 | 20,642 | 1/0 | 0 |
| Main renderer static closure | 8,450,230 | 1,883,919 | 292/2 | 8,419,021 | 1,878,382 | 292/2 | -31,209 |
| Popout renderer static closure | 4,507,253 | 984,615 | 77/2 | 4,507,253 | 984,615 | 77/2 | 0 |
| Web renderer static closure | 4,360,652 | 928,347 | 33/1 | 4,360,652 | 928,352 | 33/1 | 0 |

The renderer closure gzip figures are sums of each independently gzipped emitted
file, matching the checked-in budget reporter. Web gzip changed by five bytes due
to changed hashed dependency names, but web raw and file counts are exactly
unchanged as required.

Entry and closure SHA-256 evidence:

| Entry | A emitted file / SHA-256 | B emitted file / SHA-256 | A closure-manifest SHA-256 | B closure-manifest SHA-256 |
| --- | --- | --- | --- | --- |
| Main renderer | `assets/index-DrMHawfZ.js` / `8944937a20e1c0d676e0705c061c12f233afdcfb2aadabbf6cdf5b88c37630c6` | `assets/index-BA5SMP-t.js` / `de8e663ddf2221774a5ca15e060077fd7fcc5a62bcc81c962608eb15faa0d964` | `1463a4a360c28cacbd04aaceaddb8a4f64ceebf13097cd835084ea58761b1cdf` | `319b1e52def92f4b5cffb46e3ec1b51ab741835f519360e0c6b8bb401ab9592d` |
| Popout | `assets/popout-CySA9seP.js` / `87f85c7905deb74461d6f8f72fb121dade63c4d033454ab174bc6ca1b9a70d40` | `assets/popout-BD9-2Cja.js` / `1ae8a4ad2c961bb5fb3be2f515b0335576526b0cd1b409ebc66f1d9e60ded74a` | `b9fc458caae4fe8cbadfaf44e2ed5e2efc88489cc4b5a9af8398f7be6c9b3a59` | `e20bb9bfab534fcbe64f1d82ebe3d27c5a39c3158e803511ee6967a042371c06` |
| Web | `assets/web-5bKeFUJG.js` / `5269f9e2bb4bab659469042da62c725ca6712edd69ea47d31dd1aee1e54e6ff0` | `assets/web-8LsiV0SA.js` / `87e5081c86f08716e735031827995748574abe24d2ae09a0bd2008d2c1021de9` | `4a9ca9658821d0657b2adba180f4917f17f14e47d37aac9389b12bbb787ee0c7` | `8846b5c61f38b60ee80db3482ba018d12e37ae3f994de1f3ccb7cdeef8fa7949` |

Electron identities:

- Main `out/main/index.js` A/B SHA-256:
  `6e75b9d4862f1219c23f16d6c920004167d7dae1995498caaacc5354a9d8f8fd`.
- Preload `out/preload/index.js` A/B SHA-256:
  `c388a39cdca9609760e286d95b87ad1e53793720450e507f830ff1f6c5bd259f`.
- All 184 files under `out/main` were byte-for-byte identical. The sorted
  path/size/SHA manifest hash was
  `907325898b9e2dcdbd572ca60c10d4595f656933b070566c9cea5050c7157cb8`
  for both builds.
- The one preload file was byte-for-byte identical. Its sorted manifest hash was
  `6533a865267aa457293cf183850e1480898704395f4431682703824557c84d97`
  for both builds.
- A renderer manifest: 403,061 bytes,
  `4142e98fc5f05ffd55e1c08e8cc4d0a4afb2997f95edafeb99c39dac71a2839b`.
- B renderer manifest: 403,000 bytes,
  `dc7342d1664bca2c5f42074479a81e7670655adde174c65718571c5311667123`.
- Both renderer trees contained 786 emitted files plus the manifest.

## Manifest and inclusive Acorn validation

Both renderer manifests had 778 records and all 778 referenced emitted targets
existed beneath `out/renderer`.

| Validation | A | B |
| --- | ---: | ---: |
| Manifest import/dynamic-import edges | 6,462 | 6,460 |
| JavaScript targets parsed with Acorn (`sourceType: module`, latest ECMAScript) | 697 | 697 |
| AST module edges | 6,493 | 6,491 |
| Literal relative emitted edges | 6,491 | 6,489 |
| Missing/out-of-root targets | 0 | 0 |
| Parse failures | 0 | 0 |

The walk included manifest `imports`, `dynamicImports`, CSS/assets, static imports,
re-exports, and literal dynamic imports. The B static main closure does not contain
the dialog implementation; the implementation is reachable through the existing
Settings dynamic entry.

## Budgets

Only `renderer-index.maxRawBytes` was reduced, from 8,500,037 to 8,468,828,
exactly matching the retained 31,209-byte reduction. B therefore retains the prior
49,807-byte main-renderer raw headroom. File-count budgets were unchanged.

Electron main remains at 776,873 raw against 825,109, exactly 48,236 bytes of
headroom.

## Behavior and quality gates

- Focused Vitest: 6 files, 54 tests passed.
  - durable request before host subscription;
  - first-load null Suspense fallback and one lazy load;
  - close/reopen preserves mount identity and component-local state;
  - active-run close/reopen preserves pending rows and one `getUpdateRun`
    subscription;
  - nudge-owned shared freshness scan/listener behavior;
  - status-bar reopen;
  - freshness hook cache/invalidation behavior;
  - reload key `skill-freshness-update-dialog`.
- `pnpm run typecheck:web`: passed.
- Targeted `oxlint --deny-warnings`: passed.
- Targeted `oxfmt --check`: passed.
- `pnpm run check:max-lines-ratchet`: passed with 354 grandfathered
  suppressions and no new bypass.
- `pnpm run check:electron-bundle-budgets`: passed.
- `git diff --check`: passed.

No max-lines disable or budget increase was added.

## Files in this tranche

- `config/electron-bundle-budgets.json`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/settings/Settings.tsx`
- `src/renderer/src/components/settings/settings-module-loader.ts`
- `src/renderer/src/components/skills/SkillFreshnessUpdateDialogHost.tsx`
- `src/renderer/src/components/skills/skill-freshness-update-dialog-lazy-boundary.test.tsx`
- `src/renderer/src/components/skills/SkillFreshnessUpdateDialog.tsx`
- `src/renderer/src/components/skills/SkillFreshnessUpdateDialog.test.tsx`
- `src/renderer/src/components/skills/SkillUpdateRow.tsx`
- `src/renderer/src/components/skills/skill-freshness-update-dialog.ts`
- `src/renderer/src/components/skills/SkillFreshnessNudge.tsx`
- `src/renderer/src/components/skills/SkillFreshnessNudge.test.tsx`
- `src/renderer/src/components/skills/SkillFreshnessStatusPill.tsx`
- `src/renderer/src/components/skills/SkillFreshnessStatusPill.test.tsx`
- `src/renderer/src/hooks/skill-freshness.ts`
- `src/renderer/src/hooks/useSkillFreshness.ts`

## Residual limits

No packaged macOS, Linux, or Windows launch was performed. Packaged ASAR loading,
platform-specific renderer startup, and a real IPC-backed update run remain
unvalidated in this tranche; the evidence is production-build, static-closure,
type/lint/format, and focused jsdom/happy-dom behavior coverage.
