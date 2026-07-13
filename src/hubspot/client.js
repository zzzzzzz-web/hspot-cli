// HubSpot API layer. This module (and its siblings in ./hubspot) is the ONLY
// place that talks to @hubspot/api-client. It knows nothing about Commander,
// so it can be unit-tested with a fake `raw` client. Every network call goes
// through `#call`, which adds rate-limit retry/backoff and translates raw
// failures into actionable UserErrors.
import { Client } from '@hubspot/api-client';
import { withRetry } from '../lib/retry.js';
import { explainApiError } from '../lib/errors.js';

const PAGE_SIZE = 100; // HubSpot max per page for these endpoints.

export class HubSpotClient {
  #raw;
  #log;

  constructor({ token, log, raw } = {}) {
    // `raw` injection point exists purely to make this class testable.
    this.#raw = raw ?? new Client({ accessToken: token });
    this.#log = log;
  }

  // Run a single API call with retry + error translation.
  async #call(fn, { resources } = {}) {
    try {
      return await withRetry(fn, { log: this.#log });
    } catch (err) {
      throw explainApiError(err, { resources });
    }
  }

  // Paginate the CRM Search API for an object type, following the `after`
  // cursor until exhausted. `onProgress(fetched, total)` is called per page.
  async searchAll({ objectType, request, resources, onProgress }) {
    const api = this.#raw.crm[objectType].searchApi;
    const results = [];
    let after;
    do {
      const body = { limit: PAGE_SIZE, ...request, after };
      const page = await this.#call(() => api.doSearch(body), { resources });
      results.push(...page.results);
      after = page.paging?.next?.after;
      onProgress?.(results.length, page.total);
    } while (after);
    return results;
  }

  // Paginate the CRM Basic API (list all) for an object type.
  async pageAll({ objectType, properties, resources, onProgress }) {
    const api = this.#raw.crm[objectType].basicApi;
    const results = [];
    let after;
    do {
      const page = await this.#call(
        () => api.getPage(PAGE_SIZE, after, properties),
        { resources },
      );
      results.push(...page.results);
      after = page.paging?.next?.after;
      onProgress?.(results.length);
    } while (after);
    return results;
  }

  // Deal pipelines + stages, for resolving human labels and pipeline filters.
  async getDealPipelines() {
    const res = await this.#call(
      () => this.#raw.crm.pipelines.pipelinesApi.getAll('deals'),
      { resources: ['pipelines'] },
    );
    return res.results ?? [];
  }

  // All owners, for resolving owner id -> display name.
  async getOwners() {
    const results = [];
    let after;
    do {
      const page = await this.#call(
        () => this.#raw.crm.owners.ownersApi.getPage(undefined, after),
        { resources: ['owners'] },
      );
      results.push(...(page.results ?? []));
      after = page.paging?.next?.after;
    } while (after);
    return results;
  }
}
