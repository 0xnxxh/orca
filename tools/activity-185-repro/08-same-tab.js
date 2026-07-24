(() => {
  const store = window.__store;
  const WT = '502310a9-4ede-4ceb-bca1-5c10521b2ece::C:\\Users\\neil\\OneDrive\\Documents\\PowerShell';
  const TAB = '67760f3a-cedc-4326-ba1c-fb44b8235228';
  const leaf1 = '44776541-c314-459f-abcf-768111a1d001'; // real pane
  const leaf2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; // sibling pane (same tab)
  const now = Date.now();
  const mk = (leaf, label, off) => ({
    state: 'waiting', prompt: label, updatedAt: now, stateStartedAt: now - off,
    agentType: 'claude', paneKey: TAB + ':' + leaf, tabId: TAB, worktreeId: WT,
    connectionId: null, terminalTitle: label, stateHistory: []
  });
  const entries = {
    [TAB + ':' + leaf1]: mk(leaf1, 'SAMETAB_P1', 2000),
    [TAB + ':' + leaf2]: mk(leaf2, 'SAMETAB_P2', 1000)
  };
  store.setState((st) => ({
    settings: { ...(st.settings || {}), experimentalActivity: true },
    activeView: 'activity',
    agentStatusByPaneKey: { ...st.agentStatusByPaneKey, ...entries },
    agentStatusEpoch: (st.agentStatusEpoch || 0) + 1,
    sortEpoch: (st.sortEpoch || 0) + 1
  }));
  return { injected: Object.keys(entries) };
})()
