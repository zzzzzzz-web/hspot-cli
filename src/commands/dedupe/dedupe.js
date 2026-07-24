// Shared implementation for `hspot dedupe <object>`.
//
// Like `bulk update`, this is a WRITE command and follows the tool-wide safety
// model: dry-run by default (report the duplicate groups, call no write
// endpoint) and only merge when invoked with the global --live flag — and then
// only after an interactive confirmation (skippable with --yes). Merges are
// destructive and irreversible in HubSpot, so the default is deliberately safe.
//
// The object-specific pieces (fetch, merge, display, default key) are injected,
// so `contacts` and `deals` are thin wrappers over `makeDedupeHandler`.
import { formatRows, isValidFormat, deliver } from '../../lib/output.js';
import { resolveSetting } from '../../config.js';
import { UserError } from '../../lib/errors.js';
import { confirm, canPrompt } from '../../lib/prompt.js';
import { makeProgress } from '../progress.js';

// How many duplicate rows of the plan to show before summarizing the rest.
const PREVIEW_LIMIT = 20;

const REPORT_COLUMNS = [
  { key: 'key', header: 'Key' },
  { key: 'keepId', header: 'Keep ID' },
  { key: 'keep', header: 'Keep' },
  { key: 'mergeId', header: 'Merge ID' },
  { key: 'merge', header: 'Merge' },
];

export function makeDedupeHandler({ label, defaultBy, fetch, merge, display }) {
  return async function handler(opts, ctx) {
    const { client, config, isLive, log } = ctx;
    const dedupeConfig = config.dedupe?.[label] ?? {};

    const by = resolveSetting(opts.by, dedupeConfig.by, defaultBy);
    if (!by || !String(by).trim()) {
      throw new UserError('--by must name a property to dedupe on.');
    }

    const format = resolveSetting(opts.format, dedupeConfig.format ?? config.format, 'table');
    if (!isValidFormat(format)) {
      throw new UserError(`--format must be one of table|csv|json (got "${format}").`);
    }
    const output = opts.output;

    log.info(`Scanning ${label} for duplicates by "${by}"…`);
    const records = await fetch(client, { by, opts, onProgress: makeProgress(log, label) });
    log.statusDone();

    const clusters = findDuplicateClusters(records, { by });
    const dupCount = clusters.reduce((n, c) => n + c.duplicates.length, 0);

    log.info(
      `Scanned ${records.length} ${label}; found ${clusters.length} duplicate group(s) ` +
        `covering ${dupCount} record(s) that would be merged.`,
    );

    // Always render the report — this is the dry-run plan.
    const rows =
      format === 'json'
        ? clustersToJSON(clusters, display)
        : clustersToRows(clusters, display);
    const text = formatRows(rows, REPORT_COLUMNS, format);
    const where = await deliver(text, { outputPath: output });
    if (output) log.info(`Report ${where}.`);

    if (clusters.length === 0) return;

    if (!isLive) {
      log.info('Dry run — no records merged. Re-run with --live to merge each group into its primary.');
      return;
    }

    // Live path: confirm before merging (merges cannot be undone).
    if (!opts.yes) {
      if (!canPrompt()) {
        throw new UserError(
          'Refusing to merge without confirmation in a non-interactive session.',
          { hint: 'Re-run with --yes to merge non-interactively.' },
        );
      }
      const ok = await confirm(
        `Merge ${dupCount} duplicate ${label} into ${clusters.length} primary record(s)? ` +
          `This cannot be undone. [y/N] `,
      );
      if (!ok) {
        log.info('Aborted; no records merged.');
        return;
      }
    }

    const progress = makeProgress(log, `${label} merges`);
    let merged = 0;
    for (const cluster of clusters) {
      for (const dup of cluster.duplicates) {
        await merge(client, { primaryId: cluster.primary.id, mergeId: dup.id });
        merged += 1;
        progress(merged, dupCount);
      }
    }
    log.statusDone();
    log.info(`Done: merged ${merged} duplicate ${label}.`);
  };
}

// --- Pure logic (exported for unit testing) ---------------------------------

// Normalize a raw key value for grouping: trimmed and lower-cased. Empty/blank
// values normalize to '' and are treated as "no key" (never grouped).
export function normalizeKey(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

// Choose which record in a cluster survives a merge. Convention: keep the
// ORIGINAL — the earliest `createdate`. Records without a usable createdate sort
// last (never preferred unless every record lacks one). Ties break on the
// lowest numeric id, so the choice is deterministic.
export function choosePrimary(records) {
  return records.slice().sort((a, b) => {
    const ca = createTime(a);
    const cb = createTime(b);
    if (ca !== cb) return ca - cb;
    return idNum(a) - idNum(b);
  })[0];
}

// Group records by their normalized `by` value and return only the groups with
// more than one member (the duplicates). Each cluster names its surviving
// primary and the duplicates to merge into it. Clusters are ordered largest
// first so the noisiest duplicates surface at the top of the report.
export function findDuplicateClusters(records, { by }) {
  const groups = new Map();
  for (const rec of records) {
    const key = normalizeKey(rec.properties?.[by]);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const clusters = [];
  for (const [key, recs] of groups) {
    if (recs.length < 2) continue;
    const primary = choosePrimary(recs);
    const duplicates = recs.filter((r) => r !== primary);
    clusters.push({ key, primary, duplicates, size: recs.length });
  }
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}

function createTime(record) {
  const raw = record.properties?.createdate;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(t) ? Infinity : t;
}

function idNum(record) {
  const n = Number(record.id);
  return Number.isNaN(n) ? Infinity : n;
}

// One report row per duplicate record: which record is kept vs merged away.
function clustersToRows(clusters, display) {
  const rows = [];
  for (const cluster of clusters) {
    for (const dup of cluster.duplicates) {
      rows.push({
        key: cluster.key,
        keepId: cluster.primary.id,
        keep: display(cluster.primary),
        mergeId: dup.id,
        merge: display(dup),
      });
    }
  }
  if (rows.length <= PREVIEW_LIMIT) return rows;
  const shown = rows.slice(0, PREVIEW_LIMIT);
  shown.push({
    key: `… and ${rows.length - PREVIEW_LIMIT} more`,
    keepId: '',
    keep: '',
    mergeId: '',
    merge: '',
  });
  return shown;
}

// Structured JSON: one object per cluster with its primary + duplicates.
function clustersToJSON(clusters, display) {
  return clusters.map((cluster) => ({
    key: cluster.key,
    primary: { id: cluster.primary.id, name: display(cluster.primary) },
    duplicates: cluster.duplicates.map((d) => ({ id: d.id, name: display(d) })),
  }));
}
