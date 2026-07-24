(() => {
  const st = window.__store.getState();
  const TAB = '67760f3a-cedc-4326-ba1c-fb44b8235228';
  const layout = (st.terminalLayoutsByTabId || {})[TAB] ?? null;
  const ptyIds = (st.ptyIdsByTabId || {})[TAB] ?? null;
  // Collect all leaf ids referenced in the layout tree.
  const leafIds = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.leafId) leafIds.push(n.leafId);
    if (n.id && !n.children && !n.first && !n.second) leafIds.push(n.id);
    for (const k of ['children', 'first', 'second', 'panes', 'nodes']) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v) walk(v);
    }
  };
  walk(layout);
  return JSON.stringify({
    layoutType: typeof layout,
    layoutRaw: JSON.stringify(layout).slice(0, 500),
    leafIds,
    ptyIds,
    hasRealLeaf1: leafIds.includes('44776541-c314-459f-abcf-768111a1d001'),
    activeTabId: st.activeTabId,
    activeView: st.activeView
  });
})()
