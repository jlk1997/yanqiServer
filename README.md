# 研企通（yanqi-match）

> 当前波次 **M36-broker-hall-tpl-edit-ops-cards · 诚实综合约 98.2%（支付维约 45%，无真 PSP）

面向高校实验室、科研院所与企业的**通用**科研能力 / 成果 ↔ 需求对接平台。

前期：公开数据冷启动 → 归档成卡 → 可解释匹配 → 找人写邮件草稿 → **人审后发送**。  
后期：销售扩校扩企。不替代各校科研处纵向审批。

## 本机快速演示

```bash
npm install
npm run deps:up                 # 终端保持：嵌入式 Postgres :54329
npm run crawl:batch:match       # 多校 OpenAlex + 企业 CSV + 匹配
export $(grep -v '^#' .env | xargs)
npm run build -w @yanqi/api
node apps/api/dist/main.js
```

浏览器：http://127.0.0.1:3100/ （M27 登录入口；运营台 /ops.html）  
账号：`admin` / `yanqi123`（或 `X-API-Key: yanqi-admin-demo-key`）  
邀请页：http://127.0.0.1:3100/invite.html

冒烟：`npm run smoke`  
备份：`npm run backup:pg` / `npm run backup:drill` / `npm run restore:drill`  
作战包：`npm run export:pack`（可加 `-- --demandId=` / `-- --orgId=`）

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run crawl:openalex` | 批量拉默认 5 所高校 |
| `npm run crawl:csv` | 导入企业 CSV |
| `npm run crawl:batch:match` | 双边导入后再匹配 |
| `npm run match:run` | 可解释匹配 + 线索草稿 |
| `npm run notify:drafts` | 打印草稿（不真发） |
| `npm run export:pack` | 导出销售作战包 ZIP |
| `npm run smoke` | 健康检查 + 统计 + 匹配条数 |
| `npm run backup:pg` / `npm run backup:drill` / `npm run restore:drill` | pg_dump 到 backups/ |

## 环境变量要点

见 `.env.example` 与 `docs/向量与队列.md`。

- `EMBEDDING_MODE=hash|openai|local`
- `REDIS_URL`：能通则 BullMQ，否则进程内
- `SMTP_MODE=draft_only|live` + `SMTP_HOST`/`SMTP_FROM`：人审后才可能真发
- `PUBLIC_BASE_URL`：草稿里邀请链接前缀

## 目录

```
apps/api          NestJS API + 同端口运维台
apps/web/public   中文运维台 + invite.html
workers/crawl     OpenAlex / CSV
workers/match     匹配 Worker
packages/shared   分词向量 + 打分 + 写理由
scripts/          bootstrap / smoke / backup / 作战包
exports/          作战包输出
backups/          数据库备份
docs/             设计说明
```

## 就绪边界（第三波）

- **内部 BD / 运营可日用**：导入、匹配、复核、干跑发信、作战包、备份、审计。
- **尚不能当公开多租户 SaaS**：无租户隔离、无正式注册计费、无水平扩展与 pgvector SQL 热路径。

## 合规

- 不用 CNKI/万方灰爬；企业侧 CSV / 授权 API  
- 邮件默认干跑；真发需 SMTP + 人点「审核通过并入队发送」  
- AGPL 不进产品核


## 第四波入口

- 运维台：http://127.0.0.1:3100/
- 公开门户：http://127.0.0.1:3100/portal.html
- 文档：`docs/竞品对标.md`、`docs/成熟产品蓝图.md`
- 成熟度说明：见 `DONE.md`（诚实约 45%）


## 第八波速查

- 运维台新增：授权导入、路演活动、经纪人分成、集成最近探测
- 安全基线：`npm run test:security` / `npm run test:match-eval`
- pgvector：见 `docs/pgvector.md`；Docker：`npm run deps:docker`
- 自定义域名：`docs/custom-domain.md`
- 集成契约：`docs/integrations.md`


## 邮件

支持 `SMTP_*` 与 `CHANNEL_EMAIL_*` 别名；显示名默认「小蚁」。真发需 `SMTP_MODE=live` + `CONFIRM_LIVE_SEND=1` + 请求 `confirmLive`。运维台「发信 / SMTP」可探测连通（不回显密码）。


## M9 快捷入口

- 匹配工作台保存视图与快捷键（j/k/e/a/r）
- `/api/mail/templates` 模板中心
- `/api/metrics/latency` 延迟；`/api/metrics/queue` 队列积压
- 门户对接时间线：`GET /api/portal/matches/:id/timeline`


## M10

- `/api/brokers/sla` 逾期看板；成交附件
- 门户 `/portal/my-deals`
- `/api/auth/sessions*` 会话吊销；`/api/audits/export`
- 导入校验 sampleFix / airtableStyle

## 门禁（M13）

API 在 `:3100` 起来后：

```bash
npm run gate
```

依次跑：`test:match-eval` → `smoke` → `test:security`。任一失败即非 0。本地改匹配分或门户权限后务必先过门禁。

## M27 多角色

- 入口 `/`：登录后按身份进工作台
- 企业 `/work-enterprise.html` · 科研 `/work-research.html` · 经纪人 `/work-broker.html` · 运营 `/ops.html`
- 演示短名：`admin` / `enterprise` / `uni` / `broker` / `park`（密码 `yanqi123`）
- 规划：`docs/多角色产品改版-M27.md`
