/* 研企通 · 地道中文文案（别写成英语直译） */
(function (global) {
  const ZH = {
    'app.name': '研企通',
    'ops.nav.dash': '工作台',
    'ops.nav.flywheel': '采洗配联',
    'ops.nav.match': '匹配复核',
    'ops.nav.quality': '清洗质检',
    'ops.nav.webhooks': '对接通知',
    'ops.nav.lineage': '这条数据从哪来',
    'ops.nav.plans': '套餐与开关',
    'ops.search.placeholder': '搜单位、需求、能力、成果、匹配、线索…',
    'ops.search.label': '全局搜索',
    'ops.flags.title': '功能开关',
    'ops.flags.hint': '全局开关；单个机构可另设。关了对应接口会拒绝。',
    'ops.usage.title': '本月用量',
    'ops.usage.refresh': '刷新用量',
    'portal.nav.home': '首页',
    'portal.nav.deals': '我的对接',
    'portal.nav.cases': '脱敏案例',
    'portal.nav.pricing': '套餐价格',
    'portal.nav.workspace': '工作台',
    'portal.usage.title': '本月用量',
    'portal.usage.near': '快用满了',
    'portal.usage.ok': '还够用',
    'portal.board.aria': '对接看板，可用键盘挪卡片',
    'portal.board.col.requested': '待处理',
    'portal.board.col.progress': '推进中',
    'portal.board.col.intent': '有意向',
    'portal.board.col.closed': '已谈成/关闭',
    'portal.board.col.declined': '已婉拒',
    'portal.empty.demands': '还没有需求。先写清「卡在哪」比写空话标题有用。',
    'portal.empty.capabilities': '还没有能力卡。有实验室平台、团队方向都可以先挂一条。',
    'common.loading': '加载中…',
    'common.save': '保存',
    'common.refresh': '刷新',
    'common.login': '登录',
    'a11y.skip': '跳到正文',
    'flywheel.path': '采数据 → 清洗 → 匹配 → 找人发信',
  };

  function t(key, fallback) {
    if (ZH[key] != null) return ZH[key];
    return fallback != null ? fallback : key;
  }

  global.YanqiI18n = { locale: 'zh', dict: ZH, t };
})(typeof window !== 'undefined' ? window : globalThis);
