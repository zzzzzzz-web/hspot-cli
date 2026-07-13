// Deal-specific fetching + enrichment. Returns plain domain objects; the
// command layer decides how to flag/format them.
import { UserError } from '../lib/errors.js';

// Properties we ask HubSpot to return for each deal.
export const DEAL_PROPERTIES = [
  'dealname',
  'dealstage',
  'pipeline',
  'amount',
  'hubspot_owner_id',
  'hs_lastmodifieddate',
  'hs_lastactivitydate',
  'hs_is_closed',
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Fetch all OPEN deals (hs_is_closed = false), optionally filtered to one
// pipeline (by its display name). Each returned deal is enriched with resolved
// stage/owner labels and a computed `daysSinceActivity`.
export async function fetchOpenDeals(client, { pipelineName, onProgress, log } = {}) {
  // Pipelines give us stage-id -> label and (optionally) pipeline name -> id.
  // Labels are a nice-to-have; if we can't read pipelines and no pipeline
  // filter was requested, degrade gracefully to raw ids.
  let pipelines = [];
  try {
    pipelines = await client.getDealPipelines();
  } catch (err) {
    if (pipelineName) throw err; // Can't resolve the requested filter without it.
    log?.warn(`Could not load pipelines (${err.message}); showing raw stage ids.`);
  }

  const { stageLabels, pipelineLabels, pipelineIdByName } = buildPipelineMaps(pipelines);

  const filters = [{ propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' }];
  if (pipelineName) {
    const pipelineId = pipelineIdByName.get(pipelineName.toLowerCase());
    if (!pipelineId) {
      const available = [...pipelineLabels.values()].join(', ') || '(none found)';
      throw new UserError(`No deal pipeline named "${pipelineName}".`, {
        hint: `Available pipelines: ${available}`,
      });
    }
    filters.push({ propertyName: 'pipeline', operator: 'EQ', value: pipelineId });
  }

  // Owner names are a nice-to-have; degrade to raw id on failure.
  let ownerNames = new Map();
  try {
    ownerNames = await buildOwnerMap(client);
  } catch (err) {
    log?.warn(`Could not load owners (${err.message}); showing owner ids.`);
  }

  const raw = await client.searchAll({
    objectType: 'deals',
    resources: ['deals'],
    onProgress,
    request: {
      filterGroups: [{ filters }],
      properties: DEAL_PROPERTIES,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
    },
  });

  const now = Date.now();
  return raw.map((deal) => enrichDeal(deal, { now, stageLabels, pipelineLabels, ownerNames }));
}

// Batch-update deals. `inputs` is [{ id, properties }]. WRITE operation — the
// command layer must gate this behind --live. Owns the deals write scope so the
// scope name never leaks into the command layer.
export function updateDeals(client, inputs, { onProgress } = {}) {
  return client.batchUpdate({
    objectType: 'deals',
    inputs,
    resources: ['dealsWrite'],
    onProgress,
  });
}

// Exported for unit testing. Enriches one raw deal with resolved labels and a
// computed `daysSinceActivity` (prefers most recent activity, falls back to
// last modified).
export function enrichDeal(deal, { now, stageLabels, pipelineLabels, ownerNames }) {
  const p = deal.properties ?? {};
  // Prefer the most recent engagement/activity; fall back to last modified.
  const activityRaw = p.hs_lastactivitydate || p.hs_lastmodifieddate || null;
  const activityDate = activityRaw ? new Date(activityRaw) : null;
  const daysSinceActivity =
    activityDate && !Number.isNaN(activityDate.getTime())
      ? Math.floor((now - activityDate.getTime()) / DAY_MS)
      : null;

  return {
    id: deal.id,
    name: p.dealname || '(unnamed deal)',
    stage: stageLabels.get(p.dealstage) || p.dealstage || '',
    pipeline: pipelineLabels.get(p.pipeline) || p.pipeline || '',
    amount: p.amount != null && p.amount !== '' ? Number(p.amount) : null,
    owner: p.hubspot_owner_id
      ? ownerNames.get(String(p.hubspot_owner_id)) || p.hubspot_owner_id
      : '(unassigned)',
    lastActivity: activityDate ? activityDate.toISOString().slice(0, 10) : null,
    daysSinceActivity,
  };
}

function buildPipelineMaps(pipelines) {
  const stageLabels = new Map();
  const pipelineLabels = new Map();
  const pipelineIdByName = new Map();
  for (const pl of pipelines) {
    pipelineLabels.set(pl.id, pl.label);
    pipelineIdByName.set(String(pl.label).toLowerCase(), pl.id);
    for (const stage of pl.stages ?? []) stageLabels.set(stage.id, stage.label);
  }
  return { stageLabels, pipelineLabels, pipelineIdByName };
}

async function buildOwnerMap(client) {
  const owners = await client.getOwners();
  const map = new Map();
  for (const o of owners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id;
    map.set(String(o.id), name);
  }
  return map;
}
