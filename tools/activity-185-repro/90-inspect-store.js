(() => {
  const st = window.__store.getState();
  const keys = Object.keys(st);
  const tabKeys = keys.filter((k) => /tab|worktree|leaf|pane|terminal|layout|active/i.test(k));
  // Try to enumerate real terminal tabs and their leaf ids across worktrees.
  const tbw = st.tabsByWorktree || {};
  const worktrees = Object.keys(tbw);
  const tabSummary = [];
  for (const wt of worktrees) {
    for (const tab of tbw[wt] || []) {
      tabSummary.push({
        wt: wt.slice(0, 16),
        tabId: tab.id,
        title: tab.title || tab.name || null,
        leafIds: JSON.stringify(tab.layout || tab.leaves || tab.panes || null).slice(0, 200)
      });
    }
  }
  return JSON.stringify({
    tabKeys,
    worktreeCount: worktrees.length,
    tabCount: tabSummary.length,
    tabs: tabSummary.slice(0, 12),
    agentStatusPaneKeys: Object.keys(st.agentStatusByPaneKey || {}).slice(0, 12)
  }, null, 0);
})()
