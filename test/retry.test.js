// Tier 2: retry/backoff and error-to-guidance mapping.
import test from 'node:test';
import assert from 'node:assert/strict';

import { withRetry } from '../src/lib/retry.js';
import { explainApiError } from '../src/lib/errors.js';

// Collects backoff delays and resolves immediately so tests don't actually wait.
function fakeSleep() {
  const delays = [];
  const sleep = (ms) => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

test('withRetry retries on 429 then succeeds', async () => {
  const { sleep, delays } = fakeSleep();
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw { code: 429 };
      return 'ok';
    },
    { sleep, baseDelay: 10 },
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.equal(delays.length, 2);
});

test('withRetry honors Retry-After header (seconds -> ms)', async () => {
  const { sleep, delays } = fakeSleep();
  let first = true;
  await withRetry(
    async () => {
      if (first) {
        first = false;
        throw { code: 429, response: { headers: { 'retry-after': '2' } } };
      }
      return 'done';
    },
    { sleep },
  );
  assert.deepEqual(delays, [2000]);
});

test('withRetry does not retry non-retryable errors', async () => {
  const { sleep, delays } = fakeSleep();
  await assert.rejects(() => withRetry(async () => { throw { code: 404 }; }, { sleep }), (e) => e.code === 404);
  assert.equal(delays.length, 0);
});

test('withRetry gives up after the retry budget', async () => {
  const { sleep, delays } = fakeSleep();
  await assert.rejects(
    () => withRetry(async () => { throw { code: 500 }; }, { sleep, retries: 2, baseDelay: 1 }),
    (e) => e.code === 500,
  );
  assert.equal(delays.length, 2);
});

test('explainApiError maps 401 to a token hint', () => {
  const err = explainApiError({ code: 401 });
  assert.ok(err.isUserError);
  assert.match(err.message, /401/);
  assert.match(err.hint, /token/i);
});

test('explainApiError names the exact scopes on 403', () => {
  const read = explainApiError({ code: 403 }, { resources: ['deals'] });
  assert.match(read.hint, /crm\.objects\.deals\.read/);

  const write = explainApiError({ code: 403 }, { resources: ['dealsWrite'] });
  assert.match(write.hint, /crm\.objects\.deals\.write/);
});

test('explainApiError passes through unrecognized errors unchanged', () => {
  const original = { code: 418, message: "I'm a teapot" };
  assert.equal(explainApiError(original), original);
});
