// The `dedupe` command group.
//
// Like `bulk`, these commands WRITE (they merge duplicate records) and follow
// the tool-wide safety model: dry-run by default, requiring the global --live
// flag to actually merge (see src/commands/dedupe/dedupe.js and the isLive flag
// in src/context.js). Merges are irreversible, so --live also confirms first.
import { fetchContacts, mergeContacts, contactDisplay } from '../../hubspot/contacts.js';
import { fetchAllDeals, mergeDeals } from '../../hubspot/deals.js';
import { makeDedupeHandler } from './dedupe.js';

// Fetch adapters: return raw records ({ id, properties }) including the dedupe
// key property and `createdate` (used to pick the surviving primary).
const fetchContactsForDedupe = (client, { by, opts, onProgress }) =>
  fetchContacts(client, {
    lifecycleStage: opts.lifecycleStage,
    extraProps: [by, 'createdate'],
    onProgress,
  });

const fetchDealsForDedupe = (client, { by, onProgress }) =>
  fetchAllDeals(client, { by, onProgress });

const dealDisplay = (deal) => deal.properties?.dealname || `(id ${deal.id})`;

export function registerDedupeCommands(program, withContext) {
  const dedupe = program
    .command('dedupe')
    .description('Find and (with --live) merge duplicate records. Dry-run by default.');

  dedupe
    .command('contacts')
    .description('Find contacts that share a property value (default: email) and merge duplicates.')
    .option('--by <property>', 'property to match duplicates on (default "email")')
    .option('--lifecycle-stage <stage>', 'only consider contacts in this lifecycle stage')
    .option('--format <table|csv|json>', 'report format (default table)')
    .option('--output <path>', 'write the report to a file instead of stdout')
    .option('--yes', 'skip the confirmation prompt (required for non-interactive --live)')
    .action(
      withContext(
        makeDedupeHandler({
          label: 'contacts',
          defaultBy: 'email',
          fetch: fetchContactsForDedupe,
          merge: mergeContacts,
          display: contactDisplay,
        }),
      ),
    );

  dedupe
    .command('deals')
    .description('Find deals that share a property value (default: dealname) and merge duplicates.')
    .option('--by <property>', 'property to match duplicates on (default "dealname")')
    .option('--format <table|csv|json>', 'report format (default table)')
    .option('--output <path>', 'write the report to a file instead of stdout')
    .option('--yes', 'skip the confirmation prompt (required for non-interactive --live)')
    .action(
      withContext(
        makeDedupeHandler({
          label: 'deals',
          defaultBy: 'dealname',
          fetch: fetchDealsForDedupe,
          merge: mergeDeals,
          display: dealDisplay,
        }),
      ),
    );

  return dedupe;
}
