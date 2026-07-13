// Error types and helpers for turning raw HubSpot/SDK failures into clear,
// actionable messages — especially around auth and missing scopes.

// A user-facing error whose message is safe/intended to print as-is (no stack).
export class UserError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'UserError';
    this.isUserError = true;
    this.hint = hint;
  }
}

// Scopes required by each logical resource this tool touches. Used to build
// precise "add these scopes" guidance when the API returns 401/403.
export const REQUIRED_SCOPES = {
  deals: ['crm.objects.deals.read'],
  contacts: ['crm.objects.contacts.read'],
  owners: ['crm.objects.owners.read'],
  pipelines: ['crm.objects.deals.read'],
  // Write scopes (bulk update and future mutating commands).
  dealsWrite: ['crm.objects.deals.write'],
  contactsWrite: ['crm.objects.contacts.write'],
};

// Best-effort extraction of an HTTP status from the various error shapes the
// HubSpot SDK / fetch layer can throw.
export function statusOf(err) {
  return (
    err?.code ??
    err?.statusCode ??
    err?.status ??
    err?.response?.status ??
    err?.response?.statusCode ??
    undefined
  );
}

function bodyOf(err) {
  return err?.body ?? err?.response?.data ?? err?.response?.body ?? undefined;
}

// Translate a raw error into a UserError with actionable guidance when we can
// recognize it (auth/scope/rate-limit); otherwise return the original error.
// `resources` lists which logical resources the failed call needed, so we can
// name the exact scopes to add.
export function explainApiError(err, { resources = [] } = {}) {
  const status = statusOf(err);
  const body = bodyOf(err);
  const scopeList = [...new Set(resources.flatMap((r) => REQUIRED_SCOPES[r] ?? []))];

  if (status === 401) {
    return new UserError('HubSpot rejected the access token (401 Unauthorized).', {
      hint:
        'Check that HUBSPOT_TOKEN in your .env is a valid private app token and ' +
        'has not been rotated or revoked. Tokens look like "pat-na1-...".',
    });
  }

  if (status === 403) {
    // Missing scopes come back as 403; surface exactly which ones to add.
    const scopeHint = scopeList.length
      ? `Add these scope(s) to your HubSpot private app, then regenerate/copy the token:\n` +
        scopeList.map((s) => `    • ${s}`).join('\n')
      : 'The token is missing a required scope for this operation.';
    const detail =
      typeof body === 'string'
        ? body
        : body?.message
          ? body.message
          : '';
    return new UserError(
      `HubSpot denied the request (403 Forbidden)${detail ? `: ${detail}` : '.'}`,
      { hint: scopeHint },
    );
  }

  if (status === 429) {
    return new UserError('HubSpot rate limit hit and retries were exhausted (429).', {
      hint: 'Try again shortly, or reduce concurrency. The tool already retries with backoff.',
    });
  }

  return err;
}
