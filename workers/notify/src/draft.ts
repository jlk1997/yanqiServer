/**
 * 触达：只打印还能发出的草稿，绝不群发。
 * 影子、搁置、未发布、隔离和演示档案不出现在这张清单里。
 */
import { PrismaClient } from '@prisma/client';
import { join } from 'path';

const shared = require(join(__dirname, '../../../packages/shared/src/match-lib.js'));
const prisma = new PrismaClient();

function face(card: { publishStatus?: string | null; extensions?: any } | null | undefined) {
  if (!card) return null;
  const ext = card.extensions && typeof card.extensions === 'object' ? card.extensions : {};
  return { publishStatus: card.publishStatus, quarantine: Boolean(ext.quarantine), source: ext.source };
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { status: 'draft' },
    include: {
      person: true,
      match: { include: { demand: true, capability: true, outcome: true } },
    },
    take: 40,
  });
  let shown = 0;
  let held = 0;
  for (const l of leads) {
    const breakdown = (l.match?.scoreBreakdown || {}) as any;
    const block = shared.outreachBlock({
      action: breakdown.action,
      cards: [face(l.match?.demand), face(l.match?.capability), face(l.match?.outcome)].filter(Boolean),
      personStatus: l.person?.publishStatus,
    });
    if (block) {
      held += 1;
      continue;
    }
    shown += 1;
    console.log('-----');
    console.log('收件人:', l.person?.email || '(待补全)');
    console.log('主题:', l.draftSubject);
    console.log(l.draftBody);
  }
  console.log(`\n可复核草稿 ${shown} 封，内部观察已跳过 ${held} 封（SMTP_MODE=${process.env.SMTP_MODE || 'draft_only'}，未实际发送）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
