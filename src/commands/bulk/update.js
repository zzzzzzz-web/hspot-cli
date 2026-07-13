// Shared implementation for `hspot bulk update <object>`.
//
// This is the tool's first WRITE command and the reference implementation of
// the safety model: it is a dry-run by default (prints the plan, calls no write
// endpoint) and only mutates data when invoked with the global --live flag —
// and then only after an interactive confirmation (skippable with --yes).
//
// The object-specific pieces (label + update function) are injected, so `deals`
// and `contacts` are one-line wrappers over `makeUpdateHandler`.
import { readFile } from 'node:fs/promises';
import { formatRows } from '../../lib/output.js';
import { UserError } from '../../lib/errors.js';
import { confirm, canPrompt } from '../../lib/prompt.js';
import { makeProgress } from '../progress.js';

// How many rows of the plan to show before summarizing the rest.
const PREVIEW_LIMIT = 20;

export function makeUpdateHandler({ label, update }) {
  return async function handler(opts, ctx) {
    const { client, isLive, log } = ctx;

    const properties = parseSet(opts.set);
    if (Object.keys(properties).length === 0) {
      throw new UserError('Nothing to update: pass at least one --set <key>=<value>.', {
        hint: 'Example: --set hubspot_owner_id=12345',
      });
    }

    const ids = await resolveTargetIds({ ids: opts.ids, from: opts.from });
    if (ids.length === 0) {
      throw new UserError(`No target ${label} to update.`, {
        hint:
          `Provide targets with --from <audit.json> (from \`hspot audit … --format json\`) ` +
          `and/or --ids <id,id,…>.`,
      });
    }

    const inputs = ids.map((id) => ({ id, properties }));
    const setSummary = Object.entries(properties)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    // Always show what would happen — this is the dry-run plan.
    log.info(`Plan: set ${setSummary} on ${ids.length} ${label}.`);
    printPlan(inputs, properties, log);

    if (!isLive) {
      log.info(`Dry run — no changes written. Re-run with --live to apply.`);
      return;
    }

    // Live path: confirm before writing (unless --yes / non-interactive+--yes).
    if (!opts.yes) {
      if (!canPrompt()) {
        throw new UserError(
          'Refusing to write without confirmation in a non-interactive session.',
          { hint: 'Re-run with --yes to apply the update non-interactively.' },
        );
      }
      const ok = await confirm(`Apply this update to ${ids.length} ${label}? [y/N] `);
      if (!ok) {
        log.info('Aborted; no changes written.');
        return;
      }
    }

    const results = await update(client, inputs, { onProgress: makeProgress(log, label) });
    log.statusDone();
    log.info(`Done: updated ${results.length} ${label}.`);
  };
}

// Parse repeatable --set key=value pairs into a properties object.
export function parseSet(setOpts) {
  const properties = {};
  for (const pair of setOpts ?? []) {
    const eq = pair.indexOf('=');
    if (eq < 1) {
      throw new UserError(`--set expects <key>=<value> (got "${pair}").`);
    }
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (!key) throw new UserError(`--set is missing a property name (got "${pair}").`);
    properties[key] = value;
  }
  return properties;
}

// Collect target object ids from a --from JSON file and/or --ids list, deduped.
// The --from file is expected to be an array of records each with an `id`
// (the shape `hspot audit … --format json` produces).
export async function resolveTargetIds({ ids, from } = {}) {
  const collected = [];

  if (from) {
    let data;
    try {
      data = JSON.parse(await readFile(from, 'utf8'));
    } catch (err) {
      throw new UserError(`Could not read --from file "${from}": ${err.message}`);
    }
    if (!Array.isArray(data)) {
      throw new UserError(`--from file "${from}" must contain a JSON array of records.`, {
        hint: 'Use output from e.g. `hspot audit deals --format json`.',
      });
    }
    for (const rec of data) {
      const id = rec?.id;
      if (id == null) {
        throw new UserError(`A record in "${from}" has no "id" field.`);
      }
      collected.push(String(id));
    }
  }

  if (ids) {
    for (const id of String(ids).split(',').map((s) => s.trim()).filter(Boolean)) {
      collected.push(id);
    }
  }

  return [...new Set(collected)];
}

function printPlan(inputs, properties, log) {
  const columns = [
    { key: 'id', header: 'ID' },
    ...Object.keys(properties).map((k) => ({ key: k, header: k })),
  ];
  const shown = inputs.slice(0, PREVIEW_LIMIT).map((i) => ({ id: i.id, ...i.properties }));
  // The plan preview is diagnostic; keep it on stderr with the other logs.
  log.info(formatRows(shown, columns, 'table'));
  if (inputs.length > PREVIEW_LIMIT) {
    log.info(`… and ${inputs.length - PREVIEW_LIMIT} more.`);
  }
}
