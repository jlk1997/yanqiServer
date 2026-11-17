# 生产部署与 SMTP 真发 · M17

面向：**能出网访问 smtp.qq.com:587** 的 VPS / 云主机。本开发沙箱可能拦 SMTP，**不在此环境假装已真发**。

## 1. 最小运行

```bash
# 机器上需要 Node 20+、PostgreSQL（建议与开发同大版本以便 pg_restore）
git clone <你的仓库> && cd yanqi-match
cp .env.example .env
# 编辑 DATABASE_URL / AUTH_SECRET / ADMIN_API_KEY / PUBLIC_BASE_URL
npm install
npx prisma db push --schema=apps/api/prisma/schema.prisma
npm run build -w apps/api
node apps/api/dist/main.js   # 或 systemd / pm2
```

健康检查：`curl -s http://127.0.0.1:3100/api/health`

## 2. QQ 邮箱 SMTP（小蚁发件名）

在 `.env`：

```bash
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=你的QQ邮箱
SMTP_PASS=授权码   # 不是登录密码
SMTP_FROM=你的QQ邮箱
MAIL_FROM_NAME=小蚁
OPS_DISPLAY_NAME=小蚁
SMTP_MODE=live
CONFIRM_LIVE_SEND=1
```

也可用 `CHANNEL_EMAIL_*` 别名（代码已兼容）。

### 双确认真发

同时满足才会真发：

1. `SMTP_MODE=live`
2. `CONFIRM_LIVE_SEND=1`
3. 请求体 `confirmLive: true`（运维台勾选）

否则记 **干跑**，不装送达。

### 自检

```bash
npm run smtp:doctor
# 或
bash scripts/prod-smtp-check.sh
```

若出现 `Greeting never received` / 超时：多半是 **出网 587/465 被拦**，换能出网的机器或放行安全组。详见 `docs/邮件DKIM与出网说明-M9.md`。

## 3. DKIM / SPF（摘要）

- 在域名 DNS 配 SPF：包含 QQ 企业邮/邮箱服务商要求的 `include`
- DKIM：按邮箱服务商控制台生成 TXT
- 本仓库不代管 DNS；无凭证不做假「已验域」

## 4. systemd 示例（可选）

```ini
[Unit]
Description=yanqi-match API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/yanqi-match
EnvironmentFile=/opt/yanqi-match/.env
ExecStart=/usr/bin/node apps/api/dist/main.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 5. 诚实边界

- 支付 / 自动证书 / Chatwoot 仍延期  
- 同版本 `pg_restore`：生产 PG 大版本需与备份一致  
- Webhook 默认仍干跑，生产外发另设 `WEBHOOK_LIVE=1`
