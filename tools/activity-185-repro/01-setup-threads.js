(() => {
  const store = window.__store;
  const WT = '502310a9-4ede-4ceb-bca1-5c10521b2ece::C:\\Users\\neil\\OneDrive\\Documents\\PowerShell';
  const A = { tabId: '67760f3a-cedc-4326-ba1c-fb44b8235228', leaf: '44776541-c314-459f-abcf-768111a1d001', pty: WT + '@@02ce43db' };
  const B = { tabId: '20a45769-057d-407f-89f2-fa0c0b10bf93', leaf: '971e1737-5c6b-408a-ba75-f7c49c8e4ce2', pty: WT + '@@f60bcfcc' };
  const now = Date.now();
  const mkEntry = (p, startedAtOffset, label) => ({
    state: 'waiting',
    prompt: label,
    updatedAt: now,
    stateStartedAt: now - startedAtOffset,
    agentType: 'claude',
    paneKey: p.tabId + ':' + p.leaf,
    tabId: p.tabId,
    worktreeId: WT,
    connectionId: null,
    terminalTitle: 'repro',
    stateHistory: []
  });
  const entries = {
    [A.tabId + ':' + A.leaf]: mkEntry(A, 2000, 'THREAD_A_HEALTHY'),
    [B.tabId + ':' + B.leaf]: mkEntry(B, 1000, 'THREAD_B_UNSUPPORTED')
  };
  store.setState((st) => ({
    settings: { ...(st.settings || {}), experimentalActivity: true },
    activeView: 'activity',
    agentStatusByPaneKey: { ...st.agentStatusByPaneKey, ...entries },
    agentStatusEpoch: (st.agentStatusEpoch || 0) + 1,
    sortEpoch: (st.sortEpoch || 0) + 1
  }));
  return {
    activeView: store.getState().activeView,
    experimentalActivity: store.getState().settings?.experimentalActivity,
    injectedPaneKeys: Object.keys(entries),
    agentStatusCount: Object.keys(store.getState().agentStatusByPaneKey).length
  };
})()
