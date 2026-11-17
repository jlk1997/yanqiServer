# Chatwoot / AiToEarn 集成契约

## 开关

| 变量 | 作用 |
|------|------|
| 运维台保存 `baseUrl` + `apiToken` + 启用 | 配置齐全 |
| `INTEGRATIONS_LIVE` 未设或 `0` | **只干跑**：写 JobLog + Audit，返回 `stubPayload` |
| `INTEGRATIONS_LIVE=1` | 允许真实 HTTP（超时默认 8s，重试 2 次） |

## 干跑契约 `stubPayload`（schemaVersion=1）

```json
{
  "provider": "chatwoot|aitoearn",
  "action": "create_conversation|publish_draft",
  "title": "...",
  "body": "...",
  "channel": "inbox|wechat|...",
  "leadId": null,
  "matchId": null,
  "source": "yanqi-match",
  "schemaVersion": 1
}
```

## 运维台

「外部集成」页展示 `lastProbeAt / lastProbeOk / lastProbeStatus / lastProbeMessage`。点「探测」会写入库并审计。

真连需要自备 Chatwoot CE / AiToEarn 实例凭证；本仓库不内嵌密钥。
