(() => {
  const store = window.__store;
  const WT = '502310a9-4ede-4ceb-bca1-5c10521b2ece::C:\\Users\\neil\\OneDrive\\Documents\\PowerShell';
  const B = { tabId: '20a45769-057d-407f-89f2-fa0c0b10bf93', leaf: '971e1737-5c6b-408a-ba75-f7c49c8e4ce2', pty: WT + '@@f60bcfcc' };
  const paneKey = B.tabId + ':' + B.leaf;
  store.getState().setMigrationUnsupportedPty({
    ptyId: B.pty,
    paneKey,
    worktreeId: WT,
    tabId: B.tabId,
    leafId: B.leaf,
    reason: 'legacy-numeric-pane-key',
    source: 'local',
    updatedAt: Date.now()
  });
  return {
    migrationUnsupported: Object.keys(store.getState().migrationUnsupportedByPtyId),
    flaggedPaneKey: paneKey,
    flaggedPtyId: B.pty
  };
})()
