(async () => {
  const store = window.__store;
  const WT = '502310a9-4ede-4ceb-bca1-5c10521b2ece::C:\\Users\\neil\\OneDrive\\Documents\\PowerShell';
  const A = '67760f3a-cedc-4326-ba1c-fb44b8235228:44776541-c314-459f-abcf-768111a1d001';
  const B = '20a45769-057d-407f-89f2-fa0c0b10bf93:971e1737-5c6b-408a-ba75-f7c49c8e4ce2';
  const labels = ['THREAD_A_HEALTHY', 'Agent unavailable after pane identity migration'];
  const findRow = (label) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(label)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ACTIVITY_185_SNAPSHOTS = [];
  window.__REACT185_ERRORS = [];

  // Continuously bump agentStatusEpoch + refresh entry freshness, like a live agent.
  let churn = true;
  const churnLoop = () => {
    if (!churn) return;
    const st = store.getState();
    const now = Date.now();
    const cur = st.agentStatusByPaneKey;
    const next = { ...cur };
    for (const k of [A, B]) if (next[k]) next[k] = { ...next[k], updatedAt: now };
    store.setState({
      agentStatusByPaneKey: next,
      agentStatusEpoch: (st.agentStatusEpoch || 0) + 1,
      sortEpoch: (st.sortEpoch || 0) + 1
    });
    requestAnimationFrame(churnLoop);
  };
  requestAnimationFrame(churnLoop);

  // While the store churns every frame, drive a staged migration-unsupported swap
  const gap = window.__togGap ?? 40;
  const iters = window.__togIters ?? 60;
  let missing = 0;
  for (let i = 0; i < iters; i++) {
    const row = findRow(labels[i % 2]);
    if (row) row.click();
    else missing++;
    await sleep(gap);
    if (/hit an error/i.test(document.body.textContent || '')) break;
  }
  await sleep(400);
  churn = false;
  const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
  return {
    gap, iters, missing,
    boundaryTripped: /hit an error/i.test(document.body.textContent || ''),
    react185Errors: (window.__REACT185_ERRORS || []).length,
    tripped: snaps.length,
    maxRenders: snaps.reduce((m, s) => Math.max(m, s.rendersInWindow || 0), 0),
    lastSnapshot: snaps[snaps.length - 1] || null
  };
})()
