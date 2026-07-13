// Tier 1: pure logic — no network, no fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseSet, resolveTargetIds } from '../src/commands/bulk/update.js';
import { missingProperties, contactDisplay } from '../src/hubspot/contacts.js';
import { enrichDeal } from '../src/hubspot/deals.js';
import { resolveSetting } from '../src/config.js';
import { formatRows } from '../src/lib/output.js';

test('parseSet parses repeatable key=value pairs', () => {
  assert.deepEqual(parseSet(['a=1', 'b=hello world']), { a: '1', b: 'hello world' });
  // Values may contain '='.
  assert.deepEqual(parseSet(['q=a=b']), { q: 'a=b' });
});

test('parseSet rejects malformed pairs', () => {
  assert.throws(() => parseSet(['noequals']), /key=value/);
  assert.throws(() => parseSet(['=novalue']), /property name/);
});

test('resolveTargetIds merges --ids and --from, deduped', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hspot-'));
  const file = path.join(dir, 'audit.json');
  writeFileSync(file, JSON.stringify([{ id: '1' }, { id: 2 }, { id: '3' }]));

  const ids = await resolveTargetIds({ ids: '3,4', from: file });
  assert.deepEqual(ids, ['1', '2', '3', '4']); // '3' de-duplicated, numbers stringified
});

test('resolveTargetIds errors on non-array or missing id', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hspot-'));
  const bad = path.join(dir, 'obj.json');
  writeFileSync(bad, JSON.stringify({ not: 'an array' }));
  await assert.rejects(() => resolveTargetIds({ from: bad }), /must contain a JSON array/);

  const noId = path.join(dir, 'noid.json');
  writeFileSync(noId, JSON.stringify([{ name: 'x' }]));
  await assert.rejects(() => resolveTargetIds({ from: noId }), /no "id" field/);
});

test('missingProperties flags null, undefined, empty and whitespace', () => {
  const contact = {
    properties: { phone: '', company: '   ', jobtitle: 'CEO', website: null },
  };
  assert.deepEqual(
    missingProperties(contact, ['phone', 'company', 'jobtitle', 'website', 'absent']),
    ['phone', 'company', 'website', 'absent'],
  );
});

test('contactDisplay prefers name, falls back to email then id', () => {
  assert.equal(contactDisplay({ properties: { firstname: 'Ada', lastname: 'Lovelace' } }), 'Ada Lovelace');
  assert.equal(contactDisplay({ properties: { email: 'a@b.com' } }), 'a@b.com');
  assert.equal(contactDisplay({ id: '99', properties: {} }), '(id 99)');
});

test('enrichDeal computes days idle and resolves labels', () => {
  const now = Date.parse('2026-07-13T00:00:00Z');
  const stageLabels = new Map([['s1', 'Qualified']]);
  const pipelineLabels = new Map([['p1', 'Sales Pipeline']]);
  const ownerNames = new Map([['42', 'Grace Hopper']]);

  const enriched = enrichDeal(
    {
      id: 'd1',
      properties: {
        dealname: 'Big Deal',
        dealstage: 's1',
        pipeline: 'p1',
        amount: '5000',
        hubspot_owner_id: '42',
        hs_lastactivitydate: '2026-07-03T00:00:00Z',
        hs_lastmodifieddate: '2026-07-11T00:00:00Z',
      },
    },
    { now, stageLabels, pipelineLabels, ownerNames },
  );

  assert.equal(enriched.stage, 'Qualified');
  assert.equal(enriched.pipeline, 'Sales Pipeline');
  assert.equal(enriched.owner, 'Grace Hopper');
  assert.equal(enriched.amount, 5000);
  assert.equal(enriched.daysSinceActivity, 10); // prefers activity date, not modified
});

test('enrichDeal falls back to last modified, handles unassigned', () => {
  const now = Date.parse('2026-07-13T00:00:00Z');
  const empty = new Map();
  const enriched = enrichDeal(
    {
      id: 'd2',
      properties: {
        dealname: 'No Activity',
        dealstage: 'raw-stage',
        hs_lastmodifieddate: '2026-07-08T00:00:00Z',
      },
    },
    { now, stageLabels: empty, pipelineLabels: empty, ownerNames: empty },
  );
  assert.equal(enriched.daysSinceActivity, 5);
  assert.equal(enriched.stage, 'raw-stage'); // no label -> raw id
  assert.equal(enriched.owner, '(unassigned)');
  assert.equal(enriched.amount, null);
});

test('resolveSetting honors precedence: flag > config > default', () => {
  assert.equal(resolveSetting('flag', 'config', 'default'), 'flag');
  assert.equal(resolveSetting(undefined, 'config', 'default'), 'config');
  assert.equal(resolveSetting(undefined, undefined, 'default'), 'default');
  // A falsy-but-defined flag value still wins.
  assert.equal(resolveSetting(0, 5, 30), 0);
});

test('formatRows csv escapes commas, quotes and newlines', () => {
  const rows = [{ a: 'plain', b: 'has,comma' }, { a: 'quote"d', b: 'line\nbreak' }];
  const cols = [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }];
  const csv = formatRows(rows, cols, 'csv');
  assert.equal(
    csv,
    ['A,B', 'plain,"has,comma"', '"quote""d","line\nbreak"'].join('\n'),
  );
});

test('formatRows json emits full row objects', () => {
  const rows = [{ id: '1', extra: 'kept' }];
  const cols = [{ key: 'id', header: 'ID' }];
  assert.deepEqual(JSON.parse(formatRows(rows, cols, 'json')), rows);
});
