// HubSpot API layer. This module (and its siblings in ./hubspot) is the ONLY
// place that talks to @hubspot/api-client. It knows nothing about Commander,
// so it can be unit-tested with a fake `raw` client. Every network call goes
// through `#call`, which adds rate-limit retry/backoff and translates raw
// failures into actionable UserErrors.
//
// The real SDK is imported lazily (only when no `raw` is injected), so unit
// tests can exercise this class without the dependency installed.
import { withRetry } from '../lib/retry.js';
import { explainApiError } from '../lib/errors.js';

const PAGE_SIZE = 100; // HubSpot max per page for these endpoints.

export class HubSpotClient {
  #token;
  #log;
  #raw;

  constructor({ token, log, raw } = {}) {
    // `raw` injection point exists purely to make this class testable.
    this.#token = token;
    this.#log = log;
    this.#raw = raw;
  }

  // Resolve the SDK's `crm` namespace, constructing the real client on first
  // use unless one was injected.
  async #crm() {
    if (!this.#raw) {
      const { Client } = await import('@hubspot/api-client');
      this.#raw = new Client({ accessToken: this.#token });
    }
    return this.#raw.crm;
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
    const api = (await this.#crm())[objectType].searchApi;
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
    const api = (await this.#crm())[objectType].basicApi;
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

  // Batch-update objects via the CRM Batch API, chunked to HubSpot's max of
  // 100 per request. `inputs` is [{ id, properties }]. This is a WRITE call —
  // callers are responsible for gating it behind the --live safety flag.
  async batchUpdate({ objectType, inputs, resources, onProgress }) {
    const api = (await this.#crm())[objectType].batchApi;
    const results = [];
    for (let i = 0; i < inputs.length; i += PAGE_SIZE) {
      const chunk = inputs.slice(i, i + PAGE_SIZE);
      const res = await this.#call(() => api.update({ inputs: chunk }), { resources });
      results.push(...(res.results ?? []));
      onProgress?.(Math.min(i + PAGE_SIZE, inputs.length), inputs.length);
    }
    return results;
  }

  // Deal pipelines + stages, for resolving human labels and pipeline filters.
  async getDealPipelines() {
    const crm = await this.#crm();
    const res = await this.#call(
      () => crm.pipelines.pipelinesApi.getAll('deals'),
      { resources: ['pipelines'] },
    );
    return res.results ?? [];
  }

  // All owners, for resolving owner id -> display name.
  async getOwners() {
    const crm = await this.#crm();
    const results = [];
    let after;
    do {
      const page = await this.#call(
        () => crm.owners.ownersApi.getPage(undefined, after),
        { resources: ['owners'] },
      );
      results.push(...(page.results ?? []));
      after = page.paging?.next?.after;
    } while (after);
    return results;
  }
}
