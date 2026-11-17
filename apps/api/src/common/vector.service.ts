import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_DIM = Number(process.env.EMBEDDING_DIM || 256);

/**
 * 向量检索双路径：
 * - pgvector 可用：建 embedding_vec 列、回填、SQL 最近邻
 * - 否则：JSON + 应用层余弦（match-lib）+ 可选 yanqi_cosine_json 对照
 */
@Injectable()
export class VectorService implements OnModuleInit {
  private readonly log = new Logger('VectorService');
  private pgvector = false;
  private helperReady = false;
  private vecColumnsReady = false;
  private dim = DEFAULT_DIM;
  private lastMigrate: any = null;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.detect();
  }

  async detect() {
    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has`,
      );
      this.pgvector = Boolean(rows?.[0]?.has);
    } catch {
      this.pgvector = false;
    }

    if (this.pgvector) {
      this.log.log('已检测到 pgvector 扩展');
      try {
        await this.ensureVecColumns();
        this.vecColumnsReady = true;
      } catch (e: any) {
        this.vecColumnsReady = false;
        this.log.warn('embedding_vec 列未就绪：' + (e?.message || e));
      }
    } else {
      try {
        await this.prisma.$executeRawUnsafe(`
CREATE OR REPLACE FUNCTION yanqi_cosine_json(a jsonb, b jsonb)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i int;
  n int;
  dot double precision := 0;
  na double precision := 0;
  nb double precision := 0;
  ai double precision;
  bi double precision;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0; END IF;
  n := LEAST(jsonb_array_length(a), jsonb_array_length(b));
  IF n IS NULL OR n = 0 THEN RETURN 0; END IF;
  FOR i IN 0..n-1 LOOP
    ai := (a ->> i)::double precision;
    bi := (b ->> i)::double precision;
    dot := dot + ai * bi;
    na := na + ai * ai;
    nb := nb + bi * bi;
  END LOOP;
  IF na = 0 OR nb = 0 THEN RETURN 0; END IF;
  RETURN dot / (sqrt(na) * sqrt(nb));
END;
$$;`);
        this.helperReady = true;
        this.log.log('未装 pgvector：已装 JSON 余弦辅助函数，主路径仍是应用层');
      } catch (e: any) {
        this.helperReady = false;
        this.log.warn('JSON 余弦辅助函数未装上：' + (e?.message || e));
      }
    }
    return this.status();
  }

  async ensureVecColumns(dim = this.dim) {
    this.dim = dim;
    for (const table of ['Capability', 'Outcome', 'Demand']) {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS embedding_vec vector(${dim})`,
      );
    }
    // IVFFlat 在空表上可能失败，忽略
    for (const table of ['Capability', 'Outcome', 'Demand']) {
      try {
        await this.prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS ${table.toLowerCase()}_embedding_ivfflat ON "${table}" USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 100)`,
        );
      } catch (_) {
        /* 行数太少或扩展限制时跳过 */
      }
    }
  }

  /** 把 JSON embedding 回填到 embedding_vec（仅 pgvector） */
  async migrateJsonToVec(limit = 5000) {
    if (!this.pgvector) {
      return { ok: false, message: '当前库无 pgvector 扩展，跳过迁移', mode: this.status().mode };
    }
    await this.ensureVecColumns();
    const tables = ['Capability', 'Outcome', 'Demand'] as const;
    const stats: Record<string, number> = {};
    for (const table of tables) {
      // 从 jsonb 数组拼成 '[1,2,...]'::vector
      const updated: number = await this.prisma.$executeRawUnsafe(
        `UPDATE "${table}"
         SET embedding_vec = (
           SELECT ('[' || string_agg(trim(both '"' from e::text), ',') || ']')::vector
           FROM jsonb_array_elements(embedding) WITH ORDINALITY AS t(e, ord)
         )
         WHERE embedding IS NOT NULL
           AND jsonb_typeof(embedding) = 'array'
           AND jsonb_array_length(embedding) = ${this.dim}
           AND (embedding_vec IS NULL)
         `,
      );
      stats[table] = Number(updated) || 0;
    }
    this.vecColumnsReady = true;
    this.lastMigrate = { at: new Date().toISOString(), stats, dim: this.dim };
    await this.auditSafe('vector.migrate', this.lastMigrate);
    return { ok: true, ...this.lastMigrate };
  }

  private async auditSafe(action: string, meta: any) {
    try {
      await this.prisma.auditLog.create({
        data: { action, actor: 'system', targetType: 'Vector', meta },
      });
    } catch (_) {}
  }

  status() {
    const mode = this.pgvector
      ? this.vecColumnsReady
        ? 'pgvector_hot'
        : 'pgvector_detected'
      : this.helperReady
        ? 'json_sql_helper+app'
        : 'app_only';
    return {
      pgvector: this.pgvector,
      vecColumnsReady: this.vecColumnsReady,
      jsonCosineHelper: this.helperReady,
      dim: this.dim,
      mode,
      lastMigrate: this.lastMigrate,
      note: this.pgvector
        ? '生产热路径：embedding_vec + <=> ；JSON 仍保留作回退与 Prisma 读写'
        : '嵌入式/无扩展：embedding 为 JSON，打分在 Node match-lib；见 docs/pgvector.md',
    };
  }

  async cosineJson(a: number[], b: number[]) {
    if (!this.helperReady) return null;
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT yanqi_cosine_json($1::jsonb, $2::jsonb) AS score`,
      JSON.stringify(a),
      JSON.stringify(b),
    );
    return Number(rows?.[0]?.score || 0);
  }

  /**
   * SQL 最近邻（pgvector）。返回候选 id + 余弦近似分。
   * 无扩展时返回 null，调用方走应用层。
   */
  async nearestCapabilities(queryEmb: number[], opts: { limit?: number; excludeOrgId?: string } = {}) {
    if (!this.pgvector || !this.vecColumnsReady || !queryEmb?.length) return null;
    const lim = opts.limit ?? 40;
    const vec = `[${queryEmb.join(',')}]`;
    const rows: any[] = opts.excludeOrgId
      ? await this.prisma.$queryRawUnsafe(
          `SELECT id, title, "orgId",
                  1 - (embedding_vec <=> $1::vector) AS score
           FROM "Capability"
           WHERE embedding_vec IS NOT NULL AND "orgId" <> $2
           ORDER BY embedding_vec <=> $1::vector
           LIMIT $3`,
          vec,
          opts.excludeOrgId,
          lim,
        )
      : await this.prisma.$queryRawUnsafe(
          `SELECT id, title, "orgId",
                  1 - (embedding_vec <=> $1::vector) AS score
           FROM "Capability"
           WHERE embedding_vec IS NOT NULL
           ORDER BY embedding_vec <=> $1::vector
           LIMIT $2`,
          vec,
          lim,
        );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      orgId: r.orgId,
      score: Number(r.score || 0),
    }));
  }

  async nearestOutcomes(queryEmb: number[], opts: { limit?: number; excludeOrgId?: string } = {}) {
    if (!this.pgvector || !this.vecColumnsReady || !queryEmb?.length) return null;
    const lim = opts.limit ?? 40;
    const vec = `[${queryEmb.join(',')}]`;
    const rows: any[] = opts.excludeOrgId
      ? await this.prisma.$queryRawUnsafe(
          `SELECT id, title, "orgId",
                  1 - (embedding_vec <=> $1::vector) AS score
           FROM "Outcome"
           WHERE embedding_vec IS NOT NULL AND "orgId" <> $2
           ORDER BY embedding_vec <=> $1::vector
           LIMIT $3`,
          vec,
          opts.excludeOrgId,
          lim,
        )
      : await this.prisma.$queryRawUnsafe(
          `SELECT id, title, "orgId",
                  1 - (embedding_vec <=> $1::vector) AS score
           FROM "Outcome"
           WHERE embedding_vec IS NOT NULL
           ORDER BY embedding_vec <=> $1::vector
           LIMIT $2`,
          vec,
          lim,
        );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      orgId: r.orgId,
      score: Number(r.score || 0),
    }));
  }

  /** 写入单条 embedding 时同步 vec 列（有扩展才写） */
  async syncRowVec(table: 'Capability' | 'Outcome' | 'Demand', id: string, emb: number[]) {
    if (!this.pgvector || !this.vecColumnsReady || !emb?.length) return;
    if (emb.length !== this.dim) return;
    const vec = `[${emb.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET embedding_vec = $1::vector WHERE id = $2`,
      vec,
      id,
    );
  }
}
