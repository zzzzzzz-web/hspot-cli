// `hspot audit deals` — find open deals that have gone stale.
import { fetchOpenDeals } from '../../hubspot/deals.js';
import { formatRows, isValidFormat, deliver } from '../../lib/output.js';
import { resolveSetting } from '../../config.js';
import { UserError } from '../../lib/errors.js';
import { makeProgress } from '../progress.js';

const COLUMNS = [
  { key: 'name', header: 'Deal' },
  { key: 'stage', header: 'Stage' },
  { key: 'amount', header: 'Amount' },
  { key: 'owner', header: 'Owner' },
  { key: 'daysSinceActivity', header: 'Days Idle' },
  { key: 'id', header: 'Deal ID' },
];

export async function auditDeals(opts, ctx) {
  const { client, config, log } = ctx;
  const auditConfig = config.audit?.deals ?? {};

  const staleDays = Number(
    resolveSetting(opts.staleDays, auditConfig.staleDays ?? config.staleDays, 30),
  );
  if (!Number.isFinite(staleDays) || staleDays < 0) {
    throw new UserError(`--stale-days must be a non-negative number (got "${opts.staleDays}").`);
  }
  const pipeline = resolveSetting(opts.pipeline, auditConfig.pipeline, undefined);
  const format = resolveSetting(opts.format, auditConfig.format ?? config.format, 'table');
  if (!isValidFormat(format)) {
    throw new UserError(`--format must be one of table|csv|json (got "${format}").`);
  }
  const output = resolveSetting(opts.output, undefined, undefined);

  log.info(
    `Auditing open deals${pipeline ? ` in pipeline "${pipeline}"` : ''} ` +
      `for >= ${staleDays} days of inactivity…`,
  );

  const deals = await fetchOpenDeals(client, {
    pipelineName: pipeline,
    onProgress: makeProgress(log, 'deals'),
    log,
  });
  log.statusDone();

  // Stale = no activity within the window (or no activity ever recorded).
  const stale = deals
    .filter((d) => d.daysSinceActivity == null || d.daysSinceActivity >= staleDays)
    .sort((a, b) => (b.daysSinceActivity ?? Infinity) - (a.daysSinceActivity ?? Infinity));

  log.info(
    `Scanned ${deals.length} open deal(s); ${stale.length} stale (>= ${staleDays} days idle).`,
  );

  const rows =
    format === 'json' ? stale.map(toRecord) : stale.map(toDisplayRow);
  const text = formatRows(rows, COLUMNS, format);
  const where = await deliver(text, { outputPath: output });
  if (output) log.info(`Results ${where}.`);
}

// Faithful structured record for JSON output.
function toRecord(d) {
  return {
    name: d.name,
    stage: d.stage,
    amount: d.amount,
    owner: d.owner,
    daysSinceActivity: d.daysSinceActivity,
    id: d.id,
    pipeline: d.pipeline,
    lastActivity: d.lastActivity,
  };
}

// Human-friendly row for table/csv.
function toDisplayRow(d) {
  return {
    name: d.name,
    stage: d.stage,
    amount: d.amount != null ? d.amount.toLocaleString('en-US') : '',
    owner: d.owner,
    daysSinceActivity: d.daysSinceActivity == null ? 'never' : d.daysSinceActivity,
    id: d.id,
  };
}
