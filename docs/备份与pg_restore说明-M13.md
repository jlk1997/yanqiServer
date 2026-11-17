# 备份与 pg_restore 说明 · M13

## 本环境实测阻塞

| 项 | 现状 |
|----|------|
| 服务器 | embedded Postgres **18.6**（`127.0.0.1:54329`） |
| 系统 `pg_dump` / `psql` | **17.11**（Debian） |
| embedded 包二进制 | 仅有 `postgres` / `initdb` / `pg_ctl`，**无 pg_dump/pg_restore** |

因此 **`pg_dump` 直接失败**（version mismatch），本波**没有**跑通同版本 `pg_restore` 物理恢复，**不宣称**已具备官方 PITR。

## 已跑通的隔离恢复（诚实）

1. `npm run backup:drill` — JSON 快照 + 附件 sha256 清单  
2. `npm run restore:drill` — scratch schema 计数往返  
3. `npm run backup:sql-scratch` — JSON → `yanqi_sql_scratch` 建表 INSERT 校验  

## 要补齐真 pg_restore 需要什么

- 安装与服务器同大版本的 client tools（PostgreSQL **18** 的 `pg_dump`/`pg_restore`），或  
- 在可装包环境用官方镜像只作工具容器（有凭证/网络策略后再做），再对**隔离实例**演练。  

在那之前，以 JSON + sql-scratch 为权威演练路径。
