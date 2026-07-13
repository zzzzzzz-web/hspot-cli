// The `bulk` command group and its `update` subgroup.
//
// Unlike `audit`, these commands WRITE. They follow the tool-wide safety model:
// dry-run by default, requiring the global --live flag to actually mutate data
// (see src/commands/bulk/update.js and the isLive flag in src/context.js).
import { updateDeals } from '../../hubspot/deals.js';
import { updateContacts } from '../../hubspot/contacts.js';
import { makeUpdateHandler } from './update.js';

// Repeatable option collector for --set / --ids.
const collect = (value, previous = []) => previous.concat([value]);

export function registerBulkCommands(program, withContext) {
  const bulk = program
    .command('bulk')
    .description('Bulk operations on CRM records. Dry-run by default; use --live to write.');

  const update = bulk
    .command('update')
    .description('Bulk-set properties on records (requires --live to apply).');

  update
    .command('deals')
    .description('Set properties on many deals at once.')
    .requiredOption('--set <key=value>', 'property to set (repeatable)', collect)
    .option('--from <path>', 'JSON file of target records (e.g. `hspot audit deals --format json`)')
    .option('--ids <ids>', 'comma-separated deal IDs to update')
    .option('--yes', 'skip the confirmation prompt (required for non-interactive --live)')
    .action(withContext(makeUpdateHandler({ label: 'deals', update: updateDeals })));

  update
    .command('contacts')
    .description('Set properties on many contacts at once.')
    .requiredOption('--set <key=value>', 'property to set (repeatable)', collect)
    .option('--from <path>', 'JSON file of target records (e.g. `hspot audit contacts --format json`)')
    .option('--ids <ids>', 'comma-separated contact IDs to update')
    .option('--yes', 'skip the confirmation prompt (required for non-interactive --live)')
    .action(withContext(makeUpdateHandler({ label: 'contacts', update: updateContacts })));

  return bulk;
}
