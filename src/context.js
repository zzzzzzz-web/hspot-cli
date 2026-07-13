// Builds the shared "run context" handed to every command handler.
//
// This is the seam that keeps the safety model consistent across the whole
// tool: `isLive` lives here, defaulting to false (dry-run). Audit commands in
// this phase are inherently read-only, but future write commands receive the
// same context and must gate any mutating call behind `ctx.isLive` — printing
// what they *would* do otherwise. Because every command already receives this
// object, adding write commands needs no refactor of the plumbing.
import { HubSpotClient } from './hubspot/client.js';
import { loadToken, loadConfigFile } from './config.js';
import { createLogger } from './lib/logger.js';
import { UserError } from './lib/errors.js';

export async function buildContext(globalOpts = {}) {
  const token = await loadToken();
  if (!token) {
    throw new UserError('No HubSpot access token found.', {
      hint:
        'Set HUBSPOT_TOKEN in a .env file in this directory (see .env.example), ' +
        'or export it in your shell. Create a token under\n' +
        '    HubSpot > Settings > Integrations > Private Apps.',
    });
  }

  const { config, path: configPath } = await loadConfigFile();
  const log = createLogger({ level: globalOpts.verbose ? 'debug' : globalOpts.quiet ? 'warn' : 'info' });

  const isLive = Boolean(globalOpts.live);

  return {
    // Safety flag. false => dry-run (never call a write endpoint).
    isLive,
    // Merged config-file object (raw); commands apply their own defaults.
    config,
    configPath,
    log,
    // API layer, fully decoupled from Commander.
    client: new HubSpotClient({ token, log }),
  };
}
