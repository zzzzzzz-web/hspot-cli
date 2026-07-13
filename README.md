# hspot

A command-line tool for **auditing** (and, in future phases, managing) your
HubSpot CRM data.

> **Safety first.** `hspot` is **read-only by default**. Every command runs as a
> dry-run out of the box — no flag required. Any command that would ever
> write/mutate data (coming in later phases) will require an explicit `--live`
> flag; without it, such commands only print what they *would* do and never call
> a write endpoint. The audit commands in this release are inherently read-only.

## Contents
- [Requirements](#requirements)
- [Install](#install)
- [Set up a HubSpot private app](#set-up-a-hubspot-private-app)
- [Required scopes](#required-scopes)
- [Configure your token (`.env`)](#configure-your-token-env)
- [Config file (optional defaults)](#config-file-optional-defaults)
- [Usage](#usage)
  - [`hspot audit deals`](#hspot-audit-deals)
  - [`hspot audit contacts`](#hspot-audit-contacts)
- [Output formats](#output-formats)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)

## Requirements
- Node.js 20 or newer (developed/tested on Node 24).
- A HubSpot account with a private app token.

## Install

Clone/copy this repo, then from its directory:

```bash
npm install
npm link      # makes the `hspot` command available globally
```

`npm link` uses the `bin` entry in `package.json`. Alternatively, run without
linking:

```bash
node bin/hspot.js audit deals
# or, after `npm install`:
npx hspot audit deals
```

## Set up a HubSpot private app

1. In HubSpot, go to **Settings** (gear icon) → **Integrations** → **Private
   Apps**.
2. Click **Create a private app**.
3. Give it a name (e.g. `hspot CLI`).
4. Open the **Scopes** tab and add the scopes listed below.
5. Click **Create app**, then **Continue creating**.
6. On the app's details page, copy the **Access token** (starts with
   `pat-na1-...`). Treat it like a password.

### Required scopes

Add these read scopes to the private app:

| Scope | Needed for |
| --- | --- |
| `crm.objects.deals.read` | `audit deals` (deals + pipelines/stages) |
| `crm.objects.contacts.read` | `audit contacts` |
| `crm.objects.owners.read` | Resolving deal **owner** names (optional; without it, owner IDs are shown) |

If a required scope is missing, `hspot` will tell you exactly which scope to add.

## Configure your token (`.env`)

Copy the example and paste in your token:

```bash
cp .env.example .env
```

Then edit `.env`:

```dotenv
HUBSPOT_TOKEN=pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Either `HUBSPOT_TOKEN` or `HUBSPOT_PRIVATE_APP_TOKEN` works. A real environment
variable of the same name overrides the `.env` value. **Never commit `.env`** —
it is gitignored.

## Config file (optional defaults)

So you don't have to repeat flags, `hspot` reads defaults from the first of
these files it finds in the current directory:

- `.hspotrc`
- `.hspotrc.json`
- `hspot.config.json`

All are JSON. See [`hspot.config.example.json`](./hspot.config.example.json).
Precedence is:

```
CLI flag  >  config file  >  built-in default
```

Example `hspot.config.json`:

```json
{
  "staleDays": 45,
  "format": "table",
  "audit": {
    "deals": { "staleDays": 60, "pipeline": "Sales Pipeline" },
    "contacts": { "missing": "phone,company,jobtitle" }
  }
}
```

Top-level keys apply to everything; per-command keys under `audit.<command>`
override the top-level ones for that command.

## Usage

```bash
hspot --help
hspot audit --help
hspot audit deals --help
hspot audit contacts --help
```

Global flags: `--verbose` (debug logs), `--quiet` (warnings/errors only),
`--version`.

Progress and log messages go to **stderr**; result data goes to **stdout**, so
piping and redirection stay clean (e.g. `hspot audit deals --format csv > out.csv`).

### `hspot audit deals`

Fetches **open** deals (everything not closed-won/closed-lost) and flags those
with no activity in the last N days. "Activity" uses the deal's most recent
engagement (`hs_lastactivitydate`), falling back to `hs_lastmodifieddate`.

| Flag | Default | Description |
| --- | --- | --- |
| `--stale-days <n>` | `30` | Flag deals with no activity in the last `n` days. |
| `--pipeline <name>` | — | Only audit deals in this pipeline (by display name). |
| `--format <table\|csv\|json>` | `table` | Output format. |
| `--output <path>` | stdout | Write results to a file instead of stdout. |

Columns: **Deal**, **Stage**, **Amount**, **Owner**, **Days Idle**, **Deal ID**.

```bash
# Deals idle for 30+ days (default)
hspot audit deals

# Deals idle for 60+ days in a specific pipeline, as CSV to a file
hspot audit deals --stale-days 60 --pipeline "Sales Pipeline" \
  --format csv --output stale-deals.csv

# JSON to stdout (includes extra fields like pipeline and lastActivity)
hspot audit deals --format json
```

### `hspot audit contacts`

Fetches contacts and flags any that are missing one or more of the specified
properties.

| Flag | Default | Description |
| --- | --- | --- |
| `--missing <props>` | `phone,company` | Comma-separated properties to check. |
| `--lifecycle-stage <stage>` | — | Only audit contacts in this lifecycle stage. |
| `--format <table\|csv\|json>` | `table` | Output format. |
| `--output <path>` | stdout | Write results to a file instead of stdout. |

Columns: **Contact**, **Email**, **Missing**, **Lifecycle**, **Contact ID**.

```bash
# Contacts missing phone or company (default)
hspot audit contacts

# Contacts in the "lead" stage missing any of these properties
hspot audit contacts --missing "phone,company,jobtitle" \
  --lifecycle-stage lead

# Write JSON report
hspot audit contacts --format json --output contacts-audit.json
```

## Output formats

- **table** (default) — aligned columns for reading in the terminal.
- **csv** — spreadsheet-friendly; safe-quoted.
- **json** — structured records (JSON output includes some extra fields beyond
  the table columns).

Large fetches show a live progress indicator on stderr and paginate through
**all** results — nothing is silently capped at one page. Rate limits (HTTP 429)
are handled automatically with exponential backoff and `Retry-After` support.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `No HubSpot access token found.` | Create `.env` from `.env.example` and set `HUBSPOT_TOKEN`. |
| `HubSpot rejected the access token (401 …)` | Token is invalid/rotated; copy a fresh token from the private app. |
| `HubSpot denied the request (403 …)` | Add the scope(s) the message lists to your private app, then copy a new token. |
| `HubSpot rate limit hit … (429)` | Transient; the tool retries automatically. Re-run if it persists. |

Set `HSPOT_DEBUG=1` to print a full stack trace for unexpected errors.

## Architecture

The codebase is structured so future subcommands (bulk updates, enrichment,
dedupe) slot in cleanly:

```
bin/hspot.js              Thin executable entry point.
src/cli.js                Commander program + global flags + context bridge.
src/context.js            Builds the shared run context (holds `isLive`).
src/config.js             Token + config-file loading and precedence helper.
src/commands/             CLI/command layer (Commander-aware).
  audit/index.js          The `audit` command group.
  audit/deals.js          `audit deals` handler.
  audit/contacts.js       `audit contacts` handler.
src/hubspot/              HubSpot API layer (no Commander here).
  client.js               API client wrapper: pagination + retry + error mapping.
  deals.js                Deal fetching/enrichment.
  contacts.js             Contact fetching + missing-property logic.
src/lib/                  Reusable helpers (output, errors, retry, logger).
```

Two design points make later write commands drop-in:

1. **The safety seam is centralized.** `src/context.js` builds a run context
   containing `isLive` (default `false`). Every command handler already receives
   this context, so a future write command just gates its mutating calls behind
   `ctx.isLive` — printing what it *would* do otherwise. No plumbing changes.
2. **API logic is decoupled from the CLI.** Everything under `src/hubspot/`
   talks to `@hubspot/api-client` and takes plain arguments, so it can be
   unit-tested without Commander (the client accepts an injected `raw` client).
```
