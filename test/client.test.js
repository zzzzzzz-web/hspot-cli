// Tier 2: HubSpotClient against a fake `raw` client — pagination and chunking.
import test from 'node:test';
import assert from 'node:assert/strict';

import { HubSpotClient } from '../src/hubspot/client.js';
import { fakeLog, fakeRaw, page } from './helpers.js';

test('searchAll follows the after cursor across all pages', async () => {
  const { raw, record } = fakeRaw({
    deals: {
      searchApi: {
        doSearch: (() => {
          const pages = [
            page([{ id: '1' }, { id: '2' }], { after: 'CURSOR', total: 3 }),
            page([{ id: '3' }]),
          ];
          let i = 0;
          return async () => pages[i++];
        })(),
      },
    },
  });
  const client = new HubSpotClient({ raw, log: fakeLog() });

  const seen = [];
  const results = await client.searchAll({
    objectType: 'deals',
    request: { properties: ['dealname'] },
    onProgress: (n, total) => seen.push([n, total]),
  });

  assert.deepEqual(results.map((r) => r.id), ['1', '2', '3'], 'must not cap at one page');
  // Second call must forward the cursor.
  assert.equal(record[1].args[0].after, 'CURSOR');
  assert.deepEqual(seen, [[2, 3], [3, 3]]);
});

test('pageAll paginates the basic list endpoint', async () => {
  const { raw, record } = fakeRaw({
    contacts: {
      basicApi: {
        getPage: (() => {
          const pages = [page([{ id: 'a' }], { after: 'n2' }), page([{ id: 'b' }])];
          let i = 0;
          return async () => pages[i++];
        })(),
      },
    },
  });
  const client = new HubSpotClient({ raw, log: fakeLog() });

  const results = await client.pageAll({ objectType: 'contacts', properties: ['email'] });
  assert.deepEqual(results.map((r) => r.id), ['a', 'b']);
  // getPage(limit, after, properties): the 2nd call passes the cursor.
  assert.equal(record[1].args[1], 'n2');
  assert.deepEqual(record[0].args[2], ['email']);
});

test('batchUpdate chunks inputs to 100 per request', async () => {
  const chunkSizes = [];
  const { raw } = fakeRaw({
    deals: {
      batchApi: {
        update: async (body) => {
          chunkSizes.push(body.inputs.length);
          return { results: body.inputs };
        },
      },
    },
  });
  const client = new HubSpotClient({ raw, log: fakeLog() });

  const inputs = Array.from({ length: 150 }, (_, i) => ({ id: String(i), properties: { x: '1' } }));
  const results = await client.batchUpdate({ objectType: 'deals', inputs });

  assert.deepEqual(chunkSizes, [100, 50]);
  assert.equal(results.length, 150);
});
