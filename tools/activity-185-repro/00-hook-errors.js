(() => {
  if (window.__react185HookInstalled) return { already: true };
  window.__react185HookInstalled = true;
  window.__REACT185_ERRORS = [];
  const origErr = console.error.bind(console);
  console.error = (...args) => {
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : (a && a.message) || '')).join(' ');
      if (/Maximum update depth|Minified React error #185|too many re-renders/i.test(text)) {
        window.__REACT185_ERRORS.push({ kind: 'console.error', text: text.slice(0, 300), t: Date.now() });
      }
    } catch {}
    return origErr(...args);
  };
  window.addEventListener('error', (e) => {
    const text = (e && e.message) || '';
    if (/Maximum update depth|error #185|too many re-renders/i.test(text)) {
      window.__REACT185_ERRORS.push({ kind: 'window.error', text: String(text).slice(0, 300), t: Date.now() });
    }
  });
  return { installed: true };
})()
