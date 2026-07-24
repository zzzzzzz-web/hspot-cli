// Shared implementation for `hspot enrich <object>`.
//
// Enrich fills in property values, but ONLY where a record's current value is
// blank — it never overwrites data that is already there. That is the key
// difference from `bulk update` (which sets unconditionally), and it composes
// directly with `audit … --missing`: audit to find the gaps, enrich to fill
// them.
//
// It is a WRITE command and follows the tool-wide safety model: dry-run by
// default (prints the plan, calls no write endpoint) and only mutates under the
// global --live flag, after an interactive confirmation (skippable with --yes).
//
// To know which properties are blank, enrich first READS the targets' current
// values, so it needs the object's read scope as well as the write scope.
import { formatRows } from '../../lib/output.js';
import { UserError } from '../../lib/errors.js';
import { confirm, canPrompt } from '../../lib/prompt.js';
import { makeProgress } from '../progress.js';
import { parseSet, resolveTargetIds } from '../bulk/update.js';

// How many rows of the plan to show before summarizing the rest.
const PREVIEW_LIMIT = 20;

// The object-specific pieces (read + update) are injected, so `contacts` and
// `deals` are one-line wrappers over `makeEnrichHandler`.
export function makeEnrichHandler({ label, read, update }) {
  return async function handler(opts, ctx) {
    const { client, isLive, log } = ctx;

    const fills = parseSet(opts.set);
    const props = Object.keys(fills);
    if (props.length === 0) {
      throw new UserError('Nothing to enrich: pass at least one --set <key>=<value>.', {
        hint: 'Example: --set lifecyclestage=lead',
      });
    }

    const ids = await resolveTargetIds({ ids: opts.ids, from: opts.from });
    if (ids.length === 0) {
      throw new UserError(`No target ${label} to enrich.`, {
        hint:
          `Provide targets with --from <audit.json> (from \`hspot audit … --format json\`) ` +
          `and/or --ids <id,id,…>.`,
      });
    }

    // Read current values so we only fill blanks (never overwrite).
    log.info(`Reading current values for ${ids.length} ${label}…`);
    const records = await read(client, ids, props, { onProgress: makeProgress(log, label) });
    log.statusDone();

    const inputs = planFills(records, fills);

    const setSummary = Object.entries(fills)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    log.info(
      `Plan: fill blanks (${setSummary}) on ${inputs.length} of ${records.length} ${label} ` +
        `(records already populated are skipped).`,
    );
    printPlan(inputs, props, log);

    if (inputs.length === 0) {
      log.info(`Nothing to fill — every target already has ${props.length > 1 ? 'these properties' : 'this property'}.`);
      return;
    }

    if (!isLive) {
      log.info('Dry run — no changes written. Re-run with --live to apply.');
      return;
    }

    // Live path: confirm before writing (unless --yes / non-interactive+--yes).
    if (!opts.yes) {
      if (!canPrompt()) {
        throw new UserError(
          'Refusing to write without confirmation in a non-interactive session.',
          { hint: 'Re-run with --yes to apply the enrichment non-interactively.' },
        );
      }
      const ok = await confirm(`Enrich ${inputs.length} ${label}? [y/N] `);
      if (!ok) {
        log.info('Aborted; no changes written.');
        return;
      }
    }

    const results = await update(client, inputs, { onProgress: makeProgress(log, label) });
    log.statusDone();
    log.info(`Done: enriched ${results.length} ${label}.`);
  };
}

// --- Pure logic (exported for unit testing) ---------------------------------

// Which of `props` are blank (null/undefined/empty-or-whitespace) on a record.
export function blankProperties(record, props) {
  const p = record.properties ?? {};
  return props.filter((key) => {
    const v = p[key];
    return v == null || String(v).trim() === '';
  });
}

// Build batch-update inputs that fill ONLY the blank properties of each record.
// Records with nothing blank are omitted, so they are never written.
export function planFills(records, fills) {
  const props = Object.keys(fills);
  const inputs = [];
  for (const rec of records) {
    const blanks = blankProperties(rec, props);
    if (blanks.length === 0) continue;
    const properties = {};
    for (const key of blanks) properties[key] = fills[key];
    inputs.push({ id: rec.id, properties });
  }
  return inputs;
}

// Plan preview: one row per record, showing which properties would be filled
// (blank cell = not filled for that record because it was already populated).
function printPlan(inputs, props, log) {
  if (inputs.length === 0) return;
  const columns = [{ key: 'id', header: 'ID' }, ...props.map((k) => ({ key: k, header: k }))];
  const shown = inputs.slice(0, PREVIEW_LIMIT).map((i) => ({ id: i.id, ...i.properties }));
  log.info(formatRows(shown, columns, 'table'));
  if (inputs.length > PREVIEW_LIMIT) {
    log.info(`… and ${inputs.length - PREVIEW_LIMIT} more.`);
  }
}
