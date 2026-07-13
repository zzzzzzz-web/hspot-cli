// Tier 1 (highest value): the safety gate. A dry-run must NEVER call a write
// endpoint; --live must, and only with correctly-shaped inputs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeUpdateHandler } from '../src/commands/bulk/update.js';
import { updateDeals } from '../src/hubspot/deals.js';
import { fakeLog } from './helpers.js';

// A client that records batchUpdate calls without performing any I/O.
function spyClient() {
  const calls = [];
  return {
    calls,
    async batchUpdate(args) {
      calls.push(args);
      return { results: args.inputs };
    },
  };
}

const handler = makeUpdateHandler({ label: 'deals', update: updateDeals });

test('dry-run (no --live) never calls the write endpoint', async () => {
  const client = spyClient();
  const ctx = { client, isLive: false, log: fakeLog() };
  await handler({ set: ['hubspot_owner_id=42'], ids: '1,2' }, ctx);
  assert.equal(client.calls.length, 0, 'batchUpdate must not be called in dry-run');
});

test('--live --yes writes with correctly-shaped, chunk-ready inputs', async () => {
  const client = spyClient();
  const ctx = { client, isLive: true, log: fakeLog() };
  await handler({ set: ['hubspot_owner_id=42'], ids: '1,2', yes: true }, ctx);

  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.objectType, 'deals');
  assert.deepEqual(call.resources, ['dealsWrite']);
  assert.deepEqual(call.inputs, [
    { id: '1', properties: { hubspot_owner_id: '42' } },
    { id: '2', properties: { hubspot_owner_id: '42' } },
  ]);
});

test('--live without --yes refuses in a non-interactive session', async () => {
  const client = spyClient();
  const ctx = { client, isLive: true, log: fakeLog() };
  // In the test runner stdin is not a TTY, so confirmation is impossible.
  await assert.rejects(
    () => handler({ set: ['x=1'], ids: '1' }, ctx),
    /without confirmation/,
  );
  assert.equal(client.calls.length, 0, 'must not write when confirmation is refused');
});

test('requires at least one --set and at least one target', async () => {
  const ctx = { client: spyClient(), isLive: false, log: fakeLog() };
  await assert.rejects(() => handler({ set: [], ids: '1' }, ctx), /at least one --set/);
  await assert.rejects(() => handler({ set: ['x=1'] }, ctx), /No target deals/);
});
