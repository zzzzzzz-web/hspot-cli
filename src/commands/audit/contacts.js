// `hspot audit contacts` — find contacts missing key properties.
import { fetchContacts, missingProperties, contactDisplay } from '../../hubspot/contacts.js';
import { formatRows, isValidFormat, deliver } from '../../lib/output.js';
import { resolveSetting } from '../../config.js';
import { UserError } from '../../lib/errors.js';
import { makeProgress } from '../progress.js';

const DEFAULT_MISSING = ['phone', 'company'];

const COLUMNS = [
  { key: 'name', header: 'Contact' },
  { key: 'email', header: 'Email' },
  { key: 'missing', header: 'Missing' },
  { key: 'lifecycleStage', header: 'Lifecycle' },
  { key: 'id', header: 'Contact ID' },
];

export async function auditContacts(opts, ctx) {
  const { client, config, log } = ctx;
  const auditConfig = config.audit?.contacts ?? {};

  const missingRaw = resolveSetting(
    opts.missing,
    auditConfig.missing,
    DEFAULT_MISSING,
  );
  const missingProps = parseMissing(missingRaw);
  if (missingProps.length === 0) {
    throw new UserError('--missing must list at least one property (comma-separated).');
  }

  const lifecycleStage = resolveSetting(
    opts.lifecycleStage,
    auditConfig.lifecycleStage,
    undefined,
  );
  const format = resolveSetting(opts.format, auditConfig.format ?? config.format, 'table');
  if (!isValidFormat(format)) {
    throw new UserError(`--format must be one of table|csv|json (got "${format}").`);
  }
  const output = resolveSetting(opts.output, undefined, undefined);

  log.info(
    `Auditing contacts${lifecycleStage ? ` in lifecycle stage "${lifecycleStage}"` : ''} ` +
      `for missing: ${missingProps.join(', ')}…`,
  );

  const contacts = await fetchContacts(client, {
    lifecycleStage,
    missingProps,
    onProgress: makeProgress(log, 'contacts'),
  });
  log.statusDone();

  const flagged = [];
  for (const contact of contacts) {
    const missing = missingProperties(contact, missingProps);
    if (missing.length === 0) continue;
    const p = contact.properties ?? {};
    flagged.push({
      id: contact.id,
      name: contactDisplay(contact),
      email: p.email || '',
      missing,
      lifecycleStage: p.lifecyclestage || '',
    });
  }

  log.info(
    `Scanned ${contacts.length} contact(s); ${flagged.length} missing one or more of [${missingProps.join(', ')}].`,
  );

  const rows =
    format === 'json'
      ? flagged
      : flagged.map((c) => ({ ...c, missing: c.missing.join(', ') }));
  const text = formatRows(rows, COLUMNS, format);
  const where = await deliver(text, { outputPath: output });
  if (output) log.info(`Results ${where}.`);
}

function parseMissing(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
