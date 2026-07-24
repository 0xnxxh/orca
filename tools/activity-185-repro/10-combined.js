(async () => {
  const store = window.__store;
  const TAB = '67760f3a-cedc-4326-ba1c-fb44b8235228';
  const P1 = TAB + ':44776541-c314-459f-abcf-768111a1d001';
  const P2 = TAB + ':aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const labels = ['SAMETAB_P1', 'SAMETAB_P2'];
  const findRow = (l) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(l)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ACTIVITY_185_SNAPSHOTS = [];
  window.__REACT185_ERRORS = [];
  const crashed = () =>
    (window.__REACT185_ERRORS || []).length > 0 || /hit an error/i.test(document.body.textContent || '');

  // continuous store churn like live agents bumping status
  let churn = true;
  const churnLoop = () => {
    if (!churn) return;
    const st = store.getState();
    const now = Date.now();
    const cur = st.agentStatusByPaneKey;
    const next = { ...cur };
    for (const k of [P1, P2]) if (next[k]) next[k] = { ...next[k], updatedAt: now };
    store.setState({ agentStatusByPaneKey: next, agentStatusEpoch: (st.agentStatusEpoch || 0) + 1, sortEpoch: (st.sortEpoch || 0) + 1 });
    requestAnimationFrame(churnLoop);
  };
  requestAnimationFrame(churnLoop);

  findRow(labels[0])?.click(); await sleep(150);
  findRow(labels[1])?.click(); await sleep(150);

  const rounds = window.__reproRounds ?? 12;
  let round = 0;
  for (; round < rounds; round++) {
    for (let i = 0; i < 50; i++) {
      findRow(labels[i % 2])?.click();
      if (crashed()) break;
      // no await: tight synchronous burst
    }
    if (crashed()) break;
    await Promise.resolve();
    if (crashed()) break;
    await sleep(20);
    if (crashed()) break;
  }
  await sleep(300);
  churn = false;
  const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
  return {
    roundsRun: round + 1,
    react185: (window.__REACT185_ERRORS || []).length,
    react185Text: (window.__REACT185_ERRORS || [])[0]?.text?.slice(0, 180) || null,
    boundary: /hit an error/i.test(document.body.textContent || ''),
    detectorSnaps: snaps.length,
    snapshot: snaps[0] || null
  };
})()
