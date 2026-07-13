// Rate-limit / transient-error retry with exponential backoff.
// HubSpot returns 429 when you exceed the burst or daily limit; it may include
// a Retry-After header (seconds). We honor that when present, otherwise back
// off exponentially with a little jitter.
import { statusOf } from './errors.js';

const defaultSleep = (ms) => new Promise((res) => setTimeout(res, ms));

function retryAfterMs(err) {
  const headers = err?.response?.headers ?? err?.headers;
  if (!headers) return undefined;
  const raw =
    typeof headers.get === 'function'
      ? headers.get('retry-after')
      : headers['retry-after'] ?? headers['Retry-After'];
  if (raw == null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export async function withRetry(
  fn,
  { retries = 5, baseDelay = 500, maxDelay = 20000, log, sleep = defaultSleep } = {},
) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt >= retries) throw err;

      attempt += 1;
      const backoff = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      const jitter = Math.floor(Math.random() * 250);
      const delay = retryAfterMs(err) ?? backoff + jitter;
      log?.debug?.(
        `HubSpot returned ${status}; retry ${attempt}/${retries} in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}
