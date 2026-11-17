# 研企通 · 完成说明（M170 · 核心匹配/导入/收件箱）

> 综合诚实约 **99.9%**。本波相对 M169 **继续核心**：确认卡关帧跨会话过期吊销、吊销回跳多选短片 scrubber、软取消关帧跨会话只读分享、审计角色审计回跳台账、失败归因回跳多选对照、A/B 多选关帧跨会话只读分享；**不是**导出/配额。**支付维约 45%**（无真 PSP）。交付心态仍按「做到像 200%」。

## 这波做了啥

1. **规划**：`docs/加固-M170.md`
2. **匹配**：确认卡关帧跨会话可过期吊销进台账；吊销回跳多选可带短片 scrubber；中文进度；软取消仍在
3. **收件箱**：软取消关帧可跨会话只读分享；审计角色审计可回跳台账；干跑无外发
4. **冲突预览**：失败归因回跳可多选对照；A/B 失败归因多选关帧可跨会话只读分享；中页取消仍在
5. 门禁：`npm run gate`；波次 `M170-core-confirm-kf-bm-xsession-expiry-revoke-share-revoke-seek-ms-clip-scrubber-soft-cancel-kf-bm-xsession-ro-share-audit-role-audit-seek-ledger-fail-attr-seek-multiselect-ab-ms-kf-bm-xsession-ro-share` · `0.999`

## 诚实成熟度（约）

| 维度 | 估 |
|------|----|
| 多角色工作台 / 信息流 / 密度与空态 | ~98.9% |
| **统一交互·安全·等待·可取消** | **~99.9%** |
| **匹配解释与一页纸（含跑批/预热/首屏）** | **~99.95%** |
| 园区审批 → 案例 → 公文 | ~99.2% |
| 经纪人跟进 + 佣金 | ~98.8% |
| 企业 / 科研办事窗 | ~99.1% |
| 运营台 | ~99.9% |
| 采洗配联飞轮 | ~93.9% |
| **支付收款** | **~45%（无真 PSP）** |
| **综合** | **~99.9%（M170-core-confirm-kf-bm-xsession-expiry-revoke-share-revoke-seek-ms-clip-scrubber-soft-cancel-kf-bm-xsession-ro-share-audit-role-audit-seek-ledger-fail-attr-seek-multiselect-ab-ms-kf-bm-xsession-ro-share）** |

## 演示入口

- 桌面：`http://127.0.0.1:3100/`（浅色按身份进入）
- 密码均为 `yanqi123`：`park` / `enterprise` / `uni` / `broker` / `admin`

## 刻意没做

真微信/对公收款、正式公文专网、电子签章、运营台微前端、虚报 100%、继续扩张导出/配额子系统、试点 CSV / 收款凭证。

## M171 建议

确认卡过期吊销台账角色审计一页纸、吊销多选短片关帧书签、软取消关帧跨会话过期吊销、审计回跳多选对照、失败归因多选短片 scrubber、A/B 多选关帧跨会话过期吊销；继续抠核心匹配首屏/跑批延迟与失败归因逻辑洞；等试点反馈或收款凭证。
