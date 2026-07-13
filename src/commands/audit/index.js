// The `audit` command group. Registers read-only audit subcommands.
//
// Command handlers here receive (options, ctx) where ctx is the shared run
// context (see src/context.js). Audits are inherently read-only, but they use
// the exact same registration + ctx pattern that future write commands will,
// so adding e.g. `hspot dedupe contacts --live` requires no plumbing changes:
// the handler simply checks `ctx.isLive` before any mutating call.
import { auditDeals } from './deals.js';
import { auditContacts } from './contacts.js';

export function registerAuditCommands(program, withContext) {
  const audit = program
    .command('audit')
    .description('Read-only audits of your HubSpot CRM data (never writes).');

  audit
    .command('deals')
    .description('Find open deals with no recent activity (stale deals).')
    .option('--stale-days <n>', 'flag deals with no activity in the last <n> days (default 30)')
    .option('--pipeline <name>', 'only audit deals in this pipeline')
    .option('--format <table|csv|json>', 'output format (default table)')
    .option('--output <path>', 'write results to a file instead of stdout')
    .action(withContext(auditDeals));

  audit
    .command('contacts')
    .description('Find contacts missing important properties.')
    .option(
      '--missing <props>',
      'comma-separated properties to check (default "phone,company")',
    )
    .option('--lifecycle-stage <stage>', 'only audit contacts in this lifecycle stage')
    .option('--format <table|csv|json>', 'output format (default table)')
    .option('--output <path>', 'write results to a file instead of stdout')
    .action(withContext(auditContacts));

  return audit;
}
