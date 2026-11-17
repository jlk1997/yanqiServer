#!/usr/bin/env node
/**
 * M63：Lead(matchId×channel) 去重 + 唯一索引（db push 前安全执行）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 去重：同 matchId×channel 保留 updatedAt 最新、其次 id
  const deleted = await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY "matchId", channel
          ORDER BY "updatedAt" DESC NULLS LAST, id ASC
        ) AS rn
      FROM "Lead"
    )
    DELETE FROM "Lead" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Lead_matchId_channel_key"
      ON "Lead" ("matchId", channel);
  `);

  const dupLeft = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT "matchId", channel FROM "Lead"
      GROUP BY "matchId", channel HAVING COUNT(*) > 1
    ) t
  `);

  console.log(
    JSON.stringify({
      ok: true,
      wave: 'M63',
      deletedDupLeads: deleted,
      remainingDupGroups: dupLeft?.[0]?.n ?? null,
      tipZh: 'Lead.matchId×channel 已去重并建唯一索引；可 prisma db push / generate。',
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
