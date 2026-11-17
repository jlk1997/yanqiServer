# pgvector 双路径说明（含对照基准）

## 当前默认（嵌入式 Postgres）

本仓库本地开发常用 `@embedded-postgres`，**通常没有** `vector` 扩展：

| 项 | 行为 |
|----|------|
| `Capability/Outcome/Demand.embedding` | JSON 数组（Prisma 可读写） |
| 打分主路径 | Node `packages/shared/src/match-lib.js` 余弦 + 关键词 |
| SQL 辅助 | 启动时尝试创建 `yanqi_cosine_json` |
| 健康检查 | `GET /api/health` → `vector.mode` = `app_only` 或 `json_sql_helper+app` |

## Docker 生产依赖（推荐）

```bash
cd docker
docker compose up -d
# healthcheck 会确认 pg_isready + vector 扩展
```

`docker/init-pgvector.sql` 会执行 `CREATE EXTENSION IF NOT EXISTS vector`。

把 `.env` 的 `DATABASE_URL` 指到 compose 的 Postgres（默认 `postgresql://yanqi:yanqi@127.0.0.1:5432/yanqi_match`），重启 API 后：

1. `POST /api/vector/detect` → `pgvector: true`
2. `POST /api/vector/migrate` → 建 `embedding_vec` 并回填 JSON
3. 再跑匹配：候选过多时用 SQL `<=>` 预筛（`pgvector_hot`），最终可解释分仍走 match-lib

Prisma **不**把 `Unsupported("vector")` 写进 schema（避免无扩展环境 `db push` 失败）。热列由 `VectorService` 用原生 SQL 维护，JSON 列始终保留作回退。

## mode 含义

| mode | 含义 |
|------|------|
| `app_only` | 仅应用层余弦 |
| `json_sql_helper+app` | 有 SQL JSON 辅助，主路径仍应用层 |
| `pgvector_detected` | 有扩展，列尚未就绪 |
| `pgvector_hot` | 扩展 + `embedding_vec` 可用，匹配可 NN 预筛 |

## 微型对照基准（本机可复现）

在同等数据量下（约数十条需求 × 百条供给）：

| 路径 | 典型耗时（相对） | 说明 |
|------|------------------|------|
| 应用层全量打分 | 1.0× | 默认；可解释分完整 |
| pgvector NN 预筛 + 精排 | ~0.3×～0.6×（供给 >60 时更明显） | 先 `<=>` 取 TopK，再 match-lib |
| 纯 SQL `yanqi_cosine_json` | 常慢于 Node | 仅对照，不作为热路径 |

跑法：

```bash
# 应用层
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" http://127.0.0.1:3100/api/matches/run
# 有 pgvector 时先迁移
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" http://127.0.0.1:3100/api/vector/migrate
curl -X POST -H "X-API-Key: $ADMIN_API_KEY" http://127.0.0.1:3100/api/matches/run
# 看 JobLog / health.vector.mode
```

## 生产注意

- 维度默认 `EMBEDDING_DIM=256`（hash）；若换 OpenAI 句向量需统一维度再迁列
- IVFFlat 在极小表上可能建索引失败，可忽略，数据量大后再建
- 迁移完成前不要删 JSON 列
