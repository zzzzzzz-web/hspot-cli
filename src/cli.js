// Commander wiring: defines the program, global options, and the context
// bridge. This is the only file that couples the CLI framework to our command
// handlers; the handlers themselves take plain (options, ctx) and know nothing
// about Commander.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { buildContext } from './context.js';
import { registerAuditCommands } from './commands/audit/index.js';
import { registerBulkCommands } from './commands/bulk/index.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

export function buildProgram() {
  const program = new Command();

  program
    .name('hspot')
    .description(
      'Audit (and eventually manage) your HubSpot CRM data.\n' +
        'Read-only by default: mutating commands require an explicit --live flag.',
    )
    .version(pkg.version, '-V, --version')
    // Global safety + logging flags, inherited by every subcommand.
    .option('--live', 'perform writes for real (write commands only; audits are always read-only)')
    .option('-v, --verbose', 'verbose/debug logging')
    .option('-q, --quiet', 'only log warnings and errors')
    .showHelpAfterError('(add --help for usage)');

  // Bridge: build the shared run context once per invocation and hand it,
  // plus the subcommand's own options, to the handler. Kept lazy so that
  // --help/--version never require a token or network access.
  const withContext = (handler) => async (...args) => {
    const command = args[args.length - 1];
    const opts = command.opts();
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    if (ctx.configPath) ctx.log.debug(`Loaded config from ${ctx.configPath}`);
    await handler(opts, ctx);
  };

  registerAuditCommands(program, withContext);
  registerBulkCommands(program, withContext);

  return program;
}

export async function run(argv) {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    reportError(err);
    process.exitCode = 1;
  }
}

function reportError(err) {
  if (err?.isUserError) {
    process.stderr.write(`error: ${err.message}\n`);
    if (err.hint) process.stderr.write(`\n${err.hint}\n`);
    return;
  }
  // Unexpected: show enough to debug without a raw crash dump for common cases.
  process.stderr.write(`Unexpected error: ${err?.message ?? err}\n`);
  if (process.env.HSPOT_DEBUG && err?.stack) {
    process.stderr.write(`${err.stack}\n`);
  } else {
    process.stderr.write('(set HSPOT_DEBUG=1 for a full stack trace)\n');
  }
}
