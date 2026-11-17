#!/usr/bin/env node
/**
 * M62：MatchResult 供给键回填 + 去重 + 唯一索引（db push 前安全执行）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "MatchResult" ADD COLUMN IF NOT EXISTS "supplyKey" TEXT;
  `);

  const backfill = await prisma.$executeRawUnsafe(`
    UPDATE "MatchResult"
    SET "supplyKey" = CASE
      WHEN "capabilityId" IS NOT NULL THEN 'c:' || "capabilityId"
      WHEN "outcomeId" IS NOT NULL THEN 'o:' || "outcomeId"
      ELSE 'x:' || id
    END
    WHERE "supplyKey" IS NULL OR "supplyKey" = '';
  `);

  // 去重：同 demandId×supplyKey 保留 totalScore 最高、其次 updatedAt 最新
  const deleted = await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY "demandId", "supplyKey"
          ORDER BY "totalScore" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, id ASC
        ) AS rn
      FROM "MatchResult"
      WHERE "supplyKey" IS NOT NULL
    ),
    doomed AS (SELECT id FROM ranked WHERE rn > 1)
    DELETE FROM "Lead" WHERE "matchId" IN (SELECT id FROM doomed);
  `);
  const deletedMatches = await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY "demandId", "supplyKey"
          ORDER BY "totalScore" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, id ASC
        ) AS rn
      FROM "MatchResult"
      WHERE "supplyKey" IS NOT NULL
    )
    DELETE FROM "MatchResult" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  `);

  // 清理其它引用表中的孤儿（若有 cascade 则跳过）— feedback 等可能 SetNull/Cascade
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "MatchResult_demandId_supplyKey_key"
      ON "MatchResult" ("demandId", "supplyKey");
  `);

  const nullLeft = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "MatchResult" WHERE "supplyKey" IS NULL`,
  );
  console.log(
    JSON.stringify({
      ok: true,
      wave: 'M62',
      backfill,
      deletedLeadsHint: deleted,
      deletedMatches,
      nullSupplyKey: nullLeft?.[0]?.n ?? null,
      tipZh: 'MatchResult.supplyKey 已回填并建唯一索引；可 prisma db push / generate。',
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
