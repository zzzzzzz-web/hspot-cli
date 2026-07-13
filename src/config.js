// Configuration loading: environment (token) + optional config file (defaults).
//
// Precedence for any given setting is:  CLI flag  >  config file  >  built-in default.
// This module only loads the raw config-file object and the token; the actual
// per-flag merging happens in each command (which knows its own defaults), so
// that we can distinguish "user passed the flag" from "using a default".
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Config files searched (first match wins), relative to cwd.
const CONFIG_FILENAMES = ['.hspotrc', '.hspotrc.json', 'hspot.config.json'];

export function loadToken() {
  // Load .env from cwd if present; real env vars still take precedence.
  dotenv.config();
  return process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_PRIVATE_APP_TOKEN || '';
}

export async function loadConfigFile({ cwd = process.cwd() } = {}) {
  for (const name of CONFIG_FILENAMES) {
    const full = path.join(cwd, name);
    if (!existsSync(full)) continue;
    try {
      const raw = await readFile(full, 'utf8');
      const parsed = JSON.parse(raw);
      return { config: parsed ?? {}, path: full };
    } catch (err) {
      throw new Error(`Failed to parse config file ${full}: ${err.message}`);
    }
  }
  return { config: {}, path: null };
}

// Resolve a single setting following the documented precedence.
// `flagValue` should be `undefined` when the user did not pass the flag.
export function resolveSetting(flagValue, configValue, defaultValue) {
  if (flagValue !== undefined) return flagValue;
  if (configValue !== undefined) return configValue;
  return defaultValue;
}
