// The `enrich` command group.
//
// Like `bulk`, these commands WRITE and follow the tool-wide safety model:
// dry-run by default, requiring the global --live flag to actually mutate data
// (see src/commands/enrich/enrich.js and the isLive flag in src/context.js).
// Enrich fills only-blank properties, so it reads current values first — it
// needs both the read and write scopes for the object.
import { readContacts, updateContacts } from '../../hubspot/contacts.js';
import { readDeals, updateDeals } from '../../hubspot/deals.js';
import { makeEnrichHandler } from './enrich.js';

// Repeatable option collector for --set.
const collect = (value, previous = []) => previous.concat([value]);

export function registerEnrichCommands(program, withContext) {
  const enrich = program
    .command('enrich')
    .description('Fill blank properties on records (never overwrites). Dry-run by default; --live to write.');

  enrich
    .command('contacts')
    .description('Fill blank properties on many contacts at once.')
    .requiredOption('--set <key=value>', 'property + value to fill where blank (repeatable)', collect)
    .option('--from <path>', 'JSON file of target records (e.g. `hspot audit contacts --format json`)')
    .option('--ids <ids>', 'comma-separated contact IDs to enrich')
    .option('--yes', 'skip the confirmation prompt (required for non-interactive --live)')
    .action(
      withContext(makeEnrichHandler({ label: 'contacts', read: readContacts, update: updateContacts })),
    );

  enrich
    .command('deals')
    .description('Fill blank properties on many deals at once.')
    .requiredOption('--set <key=value>', 'property + value to fill where blank (repeatable)', collect)
    .option('--from <path>', 'JSON file of target records (e.g. `hspot audit deals --format json`)')
    .option('--ids <ids>', 'comma-separated deal IDs to enrich')
    .option('--yes', 'skip the confirmation prompt (required for non-interactive --live)')
    .action(
      withContext(makeEnrichHandler({ label: 'deals', read: readDeals, update: updateDeals })),
    );

  return enrich;
}
