// Contact-specific fetching. Returns raw-ish contact objects (id + properties);
// the command layer decides which requested properties count as "missing".

const BASE_PROPERTIES = ['email', 'firstname', 'lastname', 'lifecyclestage'];

// Fetch contacts, optionally filtered to a lifecycle stage. `missingProps` and
// `extraProps` are included in the property set so the caller can inspect them
// (e.g. audit checks `missingProps`; dedupe needs its key property + createdate
// via `extraProps`). When a lifecycle filter is given we use the Search API;
// otherwise we list all via the Basic API. Both paths paginate fully.
export async function fetchContacts(
  client,
  { lifecycleStage, missingProps = [], extraProps = [], onProgress } = {},
) {
  const properties = [...new Set([...BASE_PROPERTIES, ...missingProps, ...extraProps])];

  if (lifecycleStage) {
    return client.searchAll({
      objectType: 'contacts',
      resources: ['contacts'],
      onProgress,
      request: {
        filterGroups: [
          {
            filters: [
              { propertyName: 'lifecyclestage', operator: 'EQ', value: lifecycleStage },
            ],
          },
        ],
        properties,
      },
    });
  }

  return client.pageAll({
    objectType: 'contacts',
    resources: ['contacts'],
    properties,
    onProgress,
  });
}

// Batch-update contacts. `inputs` is [{ id, properties }]. WRITE operation —
// the command layer must gate this behind --live. Owns the contacts write scope.
export function updateContacts(client, inputs, { onProgress } = {}) {
  return client.batchUpdate({
    objectType: 'contacts',
    inputs,
    resources: ['contactsWrite'],
    onProgress,
  });
}

// Merge a duplicate contact into a primary one. WRITE operation — the command
// layer must gate this behind --live. Owns the contacts write scope.
export function mergeContacts(client, { primaryId, mergeId }) {
  return client.mergeObjects({
    objectType: 'contacts',
    primaryId,
    mergeId,
    resources: ['contactsWrite'],
  });
}

// Given a contact and the list of properties to check, return the subset that
// are empty/absent. A property counts as missing if it is null, undefined, or
// an empty/whitespace string.
export function missingProperties(contact, propsToCheck) {
  const p = contact.properties ?? {};
  return propsToCheck.filter((key) => {
    const v = p[key];
    return v == null || String(v).trim() === '';
  });
}

export function contactDisplay(contact) {
  const p = contact.properties ?? {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
  return name || p.email || `(id ${contact.id})`;
}
