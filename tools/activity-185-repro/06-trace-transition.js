(async () => {
  const labels = ['THREAD_A_HEALTHY', 'Agent unavailable after pane identity migration'];
  const findRow = (label) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(label)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const trace = globalThis.__ACTIVITY_185_TRACE;
  const mark = trace ? trace.length : 0;
  findRow(labels[0])?.click(); await sleep(250);
  findRow(labels[1])?.click(); await sleep(250);
  findRow(labels[0])?.click(); await sleep(250);
  const seq = (globalThis.__ACTIVITY_185_TRACE || []).slice(mark);
  return { count: seq.length, seq };
})()
