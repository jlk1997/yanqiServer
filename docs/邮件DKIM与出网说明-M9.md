# 邮件 DKIM / 出网说明（M9）

## 当前环境结论（诚实）

- 已配置 QQ SMTP（`SMTP_*` / `CHANNEL_EMAIL_*`），发件显示名 **小蚁**。
- 本沙箱对 `smtp.qq.com:587/465` **出网受限**：`verify` 常见 `Greeting never received` / TLS 断开。
- 产品行为：记 JobLog + 审计，返回中文说明，**绝不假装已送达**。换可出网机器或放行端口后再点「探测连通 / 自测信」。

## 生产建议（DKIM / SPF / DMARC）

1. **SPF**：在发信域名 TXT 增加包含腾讯企业邮 / QQ 邮箱的 SPF 机制（按服务商文档）。
2. **DKIM**：在邮箱服务商控制台开启 DKIM，把给出的 TXT/CNAME 加到域名 DNS；研企通侧只负责用正确 `From` 发信，不自建签名器。
3. **DMARC**：先 `p=none` 收报告，稳定后再 `quarantine`/`reject`。
4. **From 对齐**：`SMTP_FROM` / `CHANNEL_EMAIL_FROM` 的域名尽量与 DKIM 域一致；显示名用 `MAIL_FROM_NAME=小蚁`。
5. **双确认**：`SMTP_MODE=live` + `CONFIRM_LIVE_SEND=1` + 请求体 `confirmLive=true` 才会真发。

## 模板中心

运维台「邮件模板」：`invite` / `approve` / `match_ready` / `self_test`。可预览并套到线索草稿，仍需人审发送。
