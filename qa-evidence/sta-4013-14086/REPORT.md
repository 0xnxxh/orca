# STA-4013 / PR 14086 Electron QA

RESULT: PASS. A partitioned Google-family cookie survived a native Chromium import unchanged, including partition identity. Import still succeeded and replaced the stale non-excluded cookie.

## CDP owner
- Identity: Orca: a901260fef / qa-14086-sta4013 @ a901260fef
- Repo root: /Users/brennanbenson/orca/workspaces/orca/qa-14086-sta4013
- worktreesByRepo contains this folder workspace path
- CDP 9336 / renderer 5176 / isolated user-data profile
- HEAD a901260fef (review commit)

## Screenshots
- 01-before-import-partitioned-cookie.png — partitioned cookie present before import
- 02-import-menu-native-chrome.png — Import menu with From Google Chrome
- 03-chrome-profiles-submenu.png — chose stably.ai
- 04-after-import-partitioned-survived.png — same cookie + partitionKey after import; stale gone
- 05-settings-import-source.png — Settings shows Google Chrome (stably.ai)

## Gaps
- 69 cookies staged for restart after memory-set failures
- Toast not captured
- Partition key shown via QA overlay from CDP, not a product cookie inspector
