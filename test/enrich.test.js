// Enrich: only-blank fill logic + the --live write safety gate.
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeEnrichHandler, blankProperties, planFills } from '../src/commands/enrich/enrich.js';
import { readContacts, updateContacts } from '../src/hubspot/contacts.js';
import { fakeLog } from './helpers.js';

// --- Pure logic -------------------------------------------------------------

test('blankProperties flags null/undefined/empty/whitespace only', () => {
  const rec = { properties: { a: '', b: '  ', c: null, d: 'set', e: '0' } };
  assert.deepEqual(blankProperties(rec, ['a', 'b', 'c', 'd', 'e', 'missing']), [
    'a',
    'b',
    'c',
    'missing',
  ]);
  // A value of "0" is present, not blank.
  assert.deepEqual(blankProperties(rec, ['e']), []);
});

test('planFills fills only blank props and skips fully-populated records', () => {
  const records = [
    { id: '1', properties: { phone: '', company: 'Acme' } },
    { id: '2', properties: { phone: '555', company: 'Beta' } },
    { id: '3', properties: {} },
  ];
  const inputs = planFills(records, { phone: 'NEW', company: 'NEW' });
  assert.deepEqual(inputs, [
    { id: '1', properties: { phone: 'NEW' } }, // company already set → untouched
    { id: '3', properties: { phone: 'NEW', company: 'NEW' } },
  ]);
});

// --- Safety gate ------------------------------------------------------------

// Record 1 has a blank phone (fillable); record 2 already has one (skip).
const RECORDS = [
  { id: '1', properties: { phone: '' } },
  { id: '2', properties: { phone: '555-existing' } },
];

// A client that records batchRead/batchUpdate calls without performing I/O.
function spyClient(records) {
  const calls = { read: [], update: [] };
  return {
    calls,
    async batchRead(args) {
      calls.read.push(args);
      return records;
    },
    async batchUpdate(args) {
      calls.update.push(args);
      return { results: args.inputs };
    },
  };
}

const handler = makeEnrichHandler({ label: 'contacts', read: readContacts, update: updateContacts });

test('dry-run (no --live) reads but never writes', async () => {
  const client = spyClient(RECORDS);
  const ctx = { client, isLive: false, log: fakeLog() };
  await handler({ set: ['phone=555'], ids: '1,2' }, ctx);
  assert.equal(client.calls.read.length, 1, 'reads current values to find blanks');
  assert.equal(client.calls.update.length, 0, 'batchUpdate must not be called in dry-run');
});

test('--live --yes writes only the blank-filling inputs, with the write scope', async () => {
  const client = spyClient(RECORDS);
  const ctx = { client, isLive: true, log: fakeLog() };
  await handler({ set: ['phone=555'], ids: '1,2', yes: true }, ctx);

  assert.equal(client.calls.update.length, 1);
  const call = client.calls.update[0];
  assert.equal(call.objectType, 'contacts');
  assert.deepEqual(call.resources, ['contactsWrite']);
  // Only record 1 (blank phone) is written; record 2 is left alone.
  assert.deepEqual(call.inputs, [{ id: '1', properties: { phone: '555' } }]);
});

test('--live with nothing to fill writes nothing (no prompt, no error)', async () => {
  const allPopulated = [{ id: '2', properties: { phone: '555-existing' } }];
  const client = spyClient(allPopulated);
  const ctx = { client, isLive: true, log: fakeLog() };
  // No --yes, but it must return before ever needing confirmation.
  await handler({ set: ['phone=555'], ids: '2' }, ctx);
  assert.equal(client.calls.update.length, 0);
});

test('--live without --yes refuses when there IS work and no TTY', async () => {
  const client = spyClient(RECORDS);
  const ctx = { client, isLive: true, log: fakeLog() };
  await assert.rejects(
    () => handler({ set: ['phone=555'], ids: '1,2' }, ctx),
    /without confirmation/,
  );
  assert.equal(client.calls.update.length, 0, 'must not write when confirmation is impossible');
});

test('requires at least one --set and at least one target', async () => {
  const ctx = { client: spyClient(RECORDS), isLive: false, log: fakeLog() };
  await assert.rejects(() => handler({ set: [], ids: '1' }, ctx), /at least one --set/);
  await assert.rejects(() => handler({ set: ['phone=555'] }, ctx), /No target contacts/);
});
