/** 功能开关默认值（全局）。租户 Tenant.features 可覆盖。 */
export const FLAG_DEFAULTS: Record<
  string,
  { enabled: boolean; noteZh: string; module: string }
> = {
  board_dnd: {
    enabled: true,
    noteZh: '门户对接看板拖拽挪列',
    module: 'portal',
  },
  pwa: {
    enabled: true,
    noteZh: '门户轻量 PWA（静态壳；不缓存私密 API）',
    module: 'portal',
  },
  webhooks: {
    enabled: true,
    noteZh: '伙伴出站 Webhook（默认仍干跑，需 WEBHOOK_LIVE）',
    module: 'integrations',
  },
  ai_reports: {
    enabled: true,
    noteZh: '分析报告生成（含多模型桩）',
    module: 'intelligence',
  },
  team_invite: {
    enabled: true,
    noteZh: '门户协作邀请同事',
    module: 'portal',
  },
  global_search: {
    enabled: true,
    noteZh: '运维台统一搜索 omnibox',
    module: 'ops',
  },
  billing_checkout_stub: {
    enabled: true,
    noteZh: '套餐结账桩（非真支付）',
    module: 'billing',
  },
};

export const FLAG_KEYS = Object.keys(FLAG_DEFAULTS);
