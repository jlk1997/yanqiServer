/**
 * 演示：挑一条已经可以对外的草稿，走一遍审核发送（默认 dry-run）。
 * 影子、搁置、未发布和演示档案不会被选中。
 */
import { PrismaClient } from '@prisma/client';
import * as path from 'path';

const shared = require(path.join(__dirname, '../../../packages/shared/src/match-lib.js'));
const prisma = new PrismaClient();

function face(card: { publishStatus?: string | null; extensions?: any } | null | undefined) {
  if (!card) return null;
  const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  return { publishStatus: card.publishStatus, quarantine: Boolean(ext.quarantine), source: ext.source };
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { status: 'draft' },
    include: { person: true, match: { include: { demand: true, capability: true, outcome: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });
  const lead = leads.find((row) => {
    const breakdown = (row.match?.scoreBreakdown || {}) as any;
    return !shared.outreachBlock({
      action: breakdown.action,
      cards: [face(row.match?.demand), face(row.match?.capability), face(row.match?.outcome)].filter(Boolean),
      personStatus: row.person?.publishStatus,
    });
  });
  if (!lead) {
    console.log('没有可以发出的草稿');
    return;
  }
  const base = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || 3100}`;
  const key = process.env.ADMIN_API_KEY || 'yanqi-admin-demo-key';
  const r = await fetch(`${base}/api/leads/${lead.id}/approve-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify({ actor: 'demo' }),
  });
  const body = await r.json();
  console.log(JSON.stringify(body, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
