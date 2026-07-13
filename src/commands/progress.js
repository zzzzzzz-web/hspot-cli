// Builds an onProgress callback that renders a transient status line on stderr
// for large fetches. Throttled so we don't thrash the terminal.
export function makeProgress(log, label) {
  let last = 0;
  return (fetched, total) => {
    const now = Date.now();
    if (now - last < 100 && fetched % 500 !== 0) return;
    last = now;
    const suffix = total != null ? ` of ~${total}` : '';
    log.status(`Fetching ${label}… ${fetched}${suffix}`);
  };
}
