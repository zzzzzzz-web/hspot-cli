// Dedupe: pure grouping/primary logic + the --live merge safety gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  makeDedupeHandler,
  normalizeKey,
  choosePrimary,
  findDuplicateClusters,
} from '../src/commands/dedupe/dedupe.js';
import { mergeContacts } from '../src/hubspot/contacts.js';
import { fakeLog } from './helpers.js';

// --- Pure logic -------------------------------------------------------------

test('normalizeKey trims + lowercases; blank/nullish become empty', () => {
  assert.equal(normalizeKey(' A@X.com '), 'a@x.com');
  assert.equal(normalizeKey('  '), '');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
});

test('findDuplicateClusters groups by normalized key, skipping singletons/blanks', () => {
  const records = [
    { id: '3', properties: { email: 'A@x.com ', createdate: '2024-03-01' } },
    { id: '1', properties: { email: 'a@x.com', createdate: '2024-01-01' } },
    { id: '2', properties: { email: 'a@x.com', createdate: '2024-02-01' } },
    { id: '4', properties: { email: 'unique@x.com', createdate: '2024-01-01' } },
    { id: '5', properties: { email: '   ' } },
  ];
  const clusters = findDuplicateClusters(records, { by: 'email' });
  assert.equal(clusters.length, 1);
  const [c] = clusters;
  assert.equal(c.key, 'a@x.com');
  assert.equal(c.size, 3);
  // Primary is the earliest createdate (the original), so id 1.
  assert.equal(c.primary.id, '1');
  assert.deepEqual(c.duplicates.map((d) => d.id).sort(), ['2', '3']);
});

test('choosePrimary keeps earliest createdate, tie-broken by lowest id', () => {
  const sameDay = [
    { id: '9', properties: { createdate: '2024-01-01' } },
    { id: '4', properties: { createdate: '2024-01-01' } },
  ];
  assert.equal(choosePrimary(sameDay).id, '4');

  // A record with no usable createdate must never be preferred over one with.
  const mixed = [
    { id: '1', properties: {} },
    { id: '2', properties: { createdate: '2024-06-01' } },
  ];
  assert.equal(choosePrimary(mixed).id, '2');
});

// --- Safety gate ------------------------------------------------------------

// Records with a duplicate email pair (ids 1 and 2 collide).
const DUPES = [
  { id: '1', properties: { email: 'a@x.com', firstname: 'A', createdate: '2024-01-01' } },
  { id: '2', properties: { email: 'a@x.com', firstname: 'B', createdate: '2024-02-01' } },
];

// A client that records mergeObjects calls without performing any I/O.
function spyClient() {
  const calls = [];
  return {
    calls,
    async mergeObjects(args) {
      calls.push(args);
      return { id: args.primaryId };
    },
  };
}

// Handler wired like the real `dedupe contacts`, but with a fetch stub so no
// network is needed. Report is written to a temp file to keep stdout clean.
function makeHandler() {
  return makeDedupeHandler({
    label: 'contacts',
    defaultBy: 'email',
    fetch: async () => DUPES,
    merge: mergeContacts,
    display: (r) => r.id,
  });
}

const tmpOut = () => path.join(mkdtempSync(path.join(tmpdir(), 'hspot-')), 'report.txt');

test('dry-run (no --live) never calls the merge endpoint', async () => {
  const client = spyClient();
  const ctx = { client, config: {}, isLive: false, log: fakeLog() };
  await makeHandler()({ output: tmpOut() }, ctx);
  assert.equal(client.calls.length, 0, 'mergeObjects must not be called in dry-run');
});

test('--live --yes merges each duplicate into its primary, with the write scope', async () => {
  const client = spyClient();
  const ctx = { client, config: {}, isLive: true, log: fakeLog() };
  await makeHandler()({ yes: true, output: tmpOut() }, ctx);

  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0], {
    objectType: 'contacts',
    primaryId: '1', // earliest createdate survives
    mergeId: '2',
    resources: ['contactsWrite'],
  });
});

test('--live without --yes refuses in a non-interactive session', async () => {
  const client = spyClient();
  const ctx = { client, config: {}, isLive: true, log: fakeLog() };
  await assert.rejects(
    () => makeHandler()({ output: tmpOut() }, ctx),
    /without confirmation/,
  );
  assert.equal(client.calls.length, 0, 'must not merge when confirmation is impossible');
});
