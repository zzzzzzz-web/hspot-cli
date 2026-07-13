// Shared test doubles.

// No-op logger with the full surface our code calls.
export function fakeLog() {
  const calls = { info: [], warn: [], debug: [], error: [] };
  return {
    calls,
    info: (...a) => calls.info.push(a.join(' ')),
    warn: (...a) => calls.warn.push(a.join(' ')),
    debug: (...a) => calls.debug.push(a.join(' ')),
    error: (...a) => calls.error.push(a.join(' ')),
    status: () => {},
    statusDone: () => {},
  };
}

// Build a fake @hubspot/api-client `raw` client. `handlers` is a nested object
// mirroring the real shape, e.g.:
//   fakeRaw({ deals: { searchApi: { doSearch: async (body) => page } } })
// Each leaf is an async fn; we wrap it to record its call args.
export function fakeRaw(handlers) {
  const record = [];
  const wrap = (path, fn) =>
    async (...args) => {
      record.push({ path, args });
      return fn(...args);
    };
  const build = (obj, prefix = '') => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'function' ? wrap(`${prefix}${k}`, v) : build(v, `${prefix}${k}.`);
    }
    return out;
  };
  return { raw: { crm: build(handlers) }, record };
}

// A page returned from a search/list endpoint.
export function page(results, { after, total } = {}) {
  return {
    results,
    total,
    paging: after ? { next: { after } } : undefined,
  };
}
