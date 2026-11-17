import { join } from 'path';

const shared = require(join(__dirname, '../../../../packages/shared/src/match-lib.js'));

export type ViewerKind = 'ops' | 'broker' | 'org';

export function viewerKind(req: any): ViewerKind {
  if (req?.authMeta?.hasKey) return 'ops';
  const role = req?.user?.role || req?.authMeta?.role;
  if (role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER') return 'ops';
  if (role === 'BROKER') return 'broker';
  return 'org';
}

export const liveCardWhere = {
  publishStatus: 'published' as const,
  NOT: [
    { extensions: { path: ['quarantine'], equals: true } },
    { extensions: { path: ['source'], equals: 'demo' } },
    { extensions: { path: ['source'], equals: 'demo_fixture' } },
  ],
};

export function cardLive(row: any) {
  if (!row) return false;
  if (row.publishStatus && row.publishStatus !== 'published') return false;
  const ext = row.extensions && typeof row.extensions === 'object' ? row.extensions : {};
  if (ext.quarantine || shared.isDemoSource(ext.source)) return false;
  return true;
}

export function matchShareBlock(match: any) {
  const breakdown = match?.scoreBreakdown && typeof match.scoreBreakdown === 'object' ? match.scoreBreakdown : {};
  const face = (card: any) => {
    if (!card) return null;
    const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
    return { publishStatus: card.publishStatus, quarantine: Boolean(ext.quarantine), source: ext.source };
  };
  return shared.externalShareBlock({
    action: breakdown.action,
    cards: [face(match?.demand), face(match?.capability), face(match?.outcome)].filter(Boolean),
  });
}

function orgBrief(org: any) {
  if (!org) return null;
  return { id: org.id, name: org.name, region: org.region || null, type: org.type || null };
}

export function stripVector(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  delete out.embedding;
  delete out.embeddingModel;
  if (Array.isArray(out.people)) out.people = out.people.map(stripVector);
  if (Array.isArray(out.capabilities)) out.capabilities = out.capabilities.map(stripVector);
  if (Array.isArray(out.outcomes)) out.outcomes = out.outcomes.map(stripVector);
  if (Array.isArray(out.demands)) out.demands = out.demands.map(stripVector);
  if (out.org) out.org = stripVector(out.org);
  return out;
}

export function publicCard(row: any) {
  const text = row.summaryPublic || '';
  return {
    id: row.id,
    title: row.title,
    summary: text || null,
    abstract: row.summaryPublic || null,
    problem: row.summaryPublic || null,
    keywords: (row.keywords || row.industry || row.ipcOrDisc || []).slice(0, 8),
    trl: row.trl ?? null,
    year: row.year || null,
    type: row.type || null,
    publishStatus: 'published',
    orgId: row.orgId || null,
    org: orgBrief(row.org),
  };
}

export function publicPerson(row: any, withContact: boolean) {
  return {
    id: row.id,
    name: row.name,
    role: row.role || null,
    orgId: row.orgId || null,
    email: withContact ? row.email || null : null,
    phone: withContact ? row.phone || null : null,
    keywords: row.keywords || [],
    publishStatus: row.publishStatus || null,
    org: orgBrief(row.org),
  };
}

export function publicOrg(row: any) {
  const cards = (list: any[]) => (list || []).filter(cardLive).map(publicCard);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    region: row.region || null,
    summary: row.summaryPublic || null,
    publishStatus: row.publishStatus || null,
    capabilities: cards(row.capabilities),
    outcomes: cards(row.outcomes),
    demands: cards(row.demands),
    people: (row.people || []).filter(cardLive).map((person: any) => publicPerson(person, false)),
  };
}
